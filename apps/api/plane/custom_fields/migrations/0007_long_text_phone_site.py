from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hentis_fields", "0006_upgrade_saved_query_schema")]

    operations = [
        migrations.AlterField(
            model_name="field",
            name="kind",
            field=models.CharField(
                choices=[
                    (kind, kind)
                    for kind in (
                        "text",
                        "long_text",
                        "number",
                        "date",
                        "boolean",
                        "select",
                        "multiselect",
                        "url",
                        "phone",
                        "site",
                    )
                ],
                max_length=12,
            ),
        ),
    ]
