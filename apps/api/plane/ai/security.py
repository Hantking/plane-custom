import hashlib
import ipaddress
import os
import socket
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from django.shortcuts import get_object_or_404
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied, ValidationError
from plane.db.models import (
    Workspace,
    WorkspaceMember,
    ProjectMember,
    Project,
    Issue,
    Page,
    User,
    ProjectPage,
    IssueComment,
)
from .models import Memory


def enabled():
    return os.environ.get("PLANE_AI_ENABLED", "0") == "1"


def cipher():
    # Separate key supports independent rotation. SECRET_KEY is NOT an implicit fallback.
    key = os.environ.get("PLANE_AI_ENCRYPTION_KEY", "")
    if not key:
        raise ValidationError("Configure PLANE_AI_ENCRYPTION_KEY no backend.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise ValidationError("PLANE_AI_ENCRYPTION_KEY deve ser uma chave Fernet válida.")


def encrypt(value):
    return cipher().encrypt(value.encode()).decode() if value else ""


def decrypt(value):
    try:
        return cipher().decrypt(value.encode()).decode() if value else ""
    except InvalidToken:
        raise ValidationError("Não foi possível decifrar a credencial. Verifique a chave de criptografia.")


def allowed_provider_hosts():
    """Accept legacy hostnames and full API URLs; authorization remains hostname-based."""
    hosts = set()
    for entry in os.environ.get("PLANE_AI_ALLOWED_HOSTS", "").replace("\n", ",").split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "://" in entry:
            try:
                parsed = urlsplit(entry)
                if (
                    parsed.scheme not in {"http", "https"}
                    or not parsed.hostname
                    or parsed.username
                    or parsed.password
                    or parsed.query
                    or parsed.fragment
                ):
                    raise ValueError()
                # Validate an explicit port even though the allowlist authorizes hosts.
                parsed.port
            except ValueError:
                raise ValidationError(
                    "PLANE_AI_ALLOWED_HOSTS contém uma URL inválida. Use URLs HTTP/HTTPS sem credenciais ou parâmetros."
                ) from None
            hosts.add(parsed.hostname.lower())
        else:
            hosts.add(entry.lower())
    return hosts


def provider_address(url):
    """Validate every request and pin its socket to this validated address (no DNS rebinding)."""
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise ValidationError("Base URL inválida.") from None
    hosts = allowed_provider_hosts()
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.hostname.lower() not in hosts
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValidationError("Base URL inválida ou host ausente de PLANE_AI_ALLOWED_HOSTS.")
    private = os.environ.get("PLANE_AI_ALLOW_PRIVATE_ENDPOINTS", "0") == "1"
    if parsed.scheme != "https" and not private:
        raise ValidationError("HTTP exige PLANE_AI_ALLOW_PRIVATE_ENDPOINTS=1.")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except (OSError, ValueError):
        raise ValidationError("Não foi possível resolver o endereço do provedor.")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if str(ip) in {"100.100.100.200", "fd00:ec2::254"}:
            raise ValidationError("Endpoint de metadados bloqueado.")
        if ip.is_link_local or ip.is_multicast or ip.is_unspecified or (not private and not ip.is_global):
            raise ValidationError("Endereço do provedor bloqueado pela política de rede.")
    if not addresses:
        raise ValidationError("Provedor sem endereço de rede.")
    return parsed, addresses[0][4][0], port


class Access:
    def __init__(self, user, slug, *, require_enabled=True):
        if require_enabled and not enabled():
            raise PermissionDenied("Plane AI está desabilitado nesta instalação.")
        self.user = user
        self.workspace = get_object_or_404(Workspace, slug=slug)
        self.member = WorkspaceMember.objects.filter(
            workspace=self.workspace, member=user, is_active=True, role__in=[5, 15, 20]
        ).first()
        if not User.objects.filter(pk=user.pk, is_active=True).exists() or self.member is None:
            raise PermissionDenied()
        self.memberships = ProjectMember.objects.filter(
            workspace=self.workspace,
            member=user,
            is_active=True,
            role__in=[5, 15, 20],
            project__archived_at__isnull=True,
            project__deleted_at__isnull=True,
        )

    def admin(self):
        if self.member.role != 20:
            raise PermissionDenied("Somente administradores do workspace podem configurar IA.")

    def projects(self):
        return Project.objects.filter(workspace=self.workspace, pk__in=self.memberships.values("project_id"))

    def project(self, identifier, write=False):
        project = get_object_or_404(self.projects(), pk=identifier)
        if write and not self.memberships.filter(project=project, role__gte=15).exists():
            raise PermissionDenied("Sem permissão de escrita neste projeto.")
        return project

    def issues(self):
        complete = self.memberships.filter(Q(role__gt=5) | Q(project__guest_view_all_features=True)).values(
            "project_id"
        )
        return Issue.issue_objects.filter(
            workspace=self.workspace, project_id__in=self.memberships.values("project_id")
        ).filter(Q(project_id__in=complete) | Q(created_by=self.user))

    def issue(self, identifier, write=False):
        issue = get_object_or_404(self.issues(), pk=identifier)
        self.project(issue.project_id, write)
        return issue

    def pages(self):
        # Match CE project-page access. Guests have no project page access.
        return (
            Page.objects.filter(
                workspace=self.workspace,
                pk__in=ProjectPage.objects.filter(
                    workspace=self.workspace,
                    deleted_at__isnull=True,
                    project_id__in=self.memberships.filter(role__gte=15).values("project_id"),
                ).values("page_id"),
                archived_at__isnull=True,
            )
            .filter(Q(owned_by=self.user) | Q(access=0))
            .distinct()
        )

    def page(self, identifier, write=False):
        page = get_object_or_404(self.pages(), pk=identifier)
        if write and (page.is_locked or (page.access == 1 and page.owned_by_id != self.user.id)):
            raise PermissionDenied("Página bloqueada ou privada.")
        return page

    def comments(self):
        # CE's comment view scopes access through the project/task; its access field
        # is not an additional private-comment ACL in that view.
        return IssueComment.objects.filter(workspace=self.workspace, issue_id__in=self.issues().values("id"))

    def memories(self):
        return Memory.objects.filter(workspace=self.workspace).filter(
            Q(kind="personal", owner=self.user)
            | Q(kind="workspace")
            | Q(kind="project", project_id__in=self.memberships.values("project_id"))
        )

    def scope(self, value):
        if not isinstance(value, dict) or value.get("kind") not in {"workspace", "project", "issue", "page"}:
            raise ValidationError("Escopo inválido.")
        kind = value["kind"]
        if kind == "workspace":
            return {"kind": kind}
        identifier = value.get("id")
        # UUID parsing through model fields must not turn malformed input into a server error.
        from uuid import UUID

        try:
            identifier = str(UUID(str(identifier)))
        except (ValueError, TypeError):
            raise ValidationError("Identificador de escopo inválido.")
        getattr(self, kind)(identifier)
        return {"kind": kind, "id": identifier}

    def sources_allowed(self, sources):
        for kind, queryset in [
            ("project", self.projects()),
            ("issue", self.issues()),
            ("page", self.pages()),
            ("comment", self.comments()),
            ("memory", self.memories()),
        ]:
            ids = {source["id"] for source in sources if source.get("kind") == kind}
            if ids and queryset.filter(pk__in=ids).distinct().count() != len(ids):
                return False
        return all(source.get("kind") in {"project", "issue", "page", "comment", "memory"} for source in sources)


def fingerprint(value):
    import json

    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()
