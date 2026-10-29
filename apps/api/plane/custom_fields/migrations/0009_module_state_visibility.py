from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("hentis_fields", "0008_optional_datetime"), ("db", "0123_issue_schedule_times")]
    operations = [
        migrations.CreateModel(
            name="ModuleStateVisibility",
            fields=[
                (
                    "module",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, primary_key=True, serialize=False, to="db.module"
                    ),
                ),
                ("state_ids", models.JSONField(default=list)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "hentis_module_state_visibility"},
        ),
    ]
