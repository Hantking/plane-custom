from django.db import migrations, models


def clear_connection_limits(apps, schema_editor):
    apps.get_model("plane_ai", "Connection").objects.using(schema_editor.connection.alias).update(
        context_tokens=None, output_tokens=None, timeout_seconds=None
    )


class Migration(migrations.Migration):
    dependencies = [("plane_ai", "0002_run_attempts_run_automation_policy")]

    operations = [
        migrations.AlterField(
            model_name="connection", name=name,
            field=models.PositiveIntegerField(blank=True, default=None, null=True),
        )
        for name in ["context_tokens", "output_tokens", "timeout_seconds"]
    ] + [migrations.RunPython(clear_connection_limits, migrations.RunPython.noop)]
