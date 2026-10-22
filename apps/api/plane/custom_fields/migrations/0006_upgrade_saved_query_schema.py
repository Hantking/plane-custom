from django.db import migrations


def upgrade(apps, schema_editor):
    View = apps.get_model("hentis_fields", "SavedView")
    for view in View.objects.filter(schema_version=1).iterator():
        if not isinstance(view.config, dict):
            continue
        config = dict(view.config)
        filters = config.get("filters", [])
        if not isinstance(filters, list):
            continue
        config.setdefault("filter_tree", {"op": "or" if config.get("match") == "any" else "and", "children": filters})
        order = config.get("order_by", "-created_at")
        if isinstance(order, str):
            config.setdefault("sorts", [{"field": order.lstrip("-"), "direction": "desc" if order.startswith("-") else "asc", "nulls": "last"}])
        config["schema_version"] = 2
        view.config, view.schema_version = config, 2
        view.save(update_fields=["config", "schema_version"])


class Migration(migrations.Migration):
    dependencies = [("hentis_fields", "0005_nativelayoutpreference_query_config_and_more")]
    operations = [migrations.RunPython(upgrade, migrations.RunPython.noop)]
