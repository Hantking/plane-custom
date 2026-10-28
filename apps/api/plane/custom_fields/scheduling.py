"""Optional wall-clock times attached to the existing native task dates."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework.exceptions import ValidationError


def validate_issue_schedule(attrs, instance=None, request=None):
    def current(key, default=None):
        return attrs.get(key, getattr(instance, key, default))

    for date_key, time_key in [("start_date", "start_time"), ("target_date", "target_time")]:
        if date_key in attrs and attrs[date_key] is None:
            attrs[time_key] = None
        if current(time_key) is not None and current(date_key) is None:
            raise ValidationError({time_key: "Escolha uma data antes de definir o horário."})

    start, end = current("start_date"), current("target_date")
    if start and end and start > end:
        raise ValidationError({"target_date": "O prazo não pode ser anterior ao início."})
    zone_name = current("schedule_timezone", "")
    has_time = current("start_time") is not None or current("target_time") is not None
    if has_time and not zone_name:
        zone_name = getattr(getattr(request, "user", None), "user_timezone", None) or "UTC"
        attrs["schedule_timezone"] = zone_name
    if zone_name:
        try:
            zone = ZoneInfo(zone_name)
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            raise ValidationError({"schedule_timezone": "Fuso horário inválido."}) from None
        instants = {}
        for date_key, time_key in [("start_date", "start_time"), ("target_date", "target_time")]:
            clock, day = current(time_key), current(date_key)
            if clock is None or day is None:
                continue
            if clock.tzinfo is not None:
                raise ValidationError({time_key: "Informe a hora local sem deslocamento de fuso."})
            local = datetime.combine(day, clock)
            instant = local.replace(tzinfo=zone).astimezone(timezone.utc)
            if instant.astimezone(zone).replace(tzinfo=None) != local:
                raise ValidationError({time_key: "Este horário não existe na data e no fuso selecionados."})
            instants[date_key] = instant
        if len(instants) == 2 and instants["start_date"] > instants["target_date"]:
            raise ValidationError({"target_time": "O horário do prazo não pode ser anterior ao início."})
    return attrs
