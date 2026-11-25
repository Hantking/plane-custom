from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hentis_fields", "0009_module_state_visibility")]
    operations = [
        migrations.AddField(
            model_name="value",
            name="rich_text_html",
            field=models.TextField(null=True),
        ),
    ]
