from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0122_alter_draftissue_assignees_alter_issue_assignees_and_more")]

    operations = [
        migrations.AddField(model_name="issue", name="start_time", field=models.TimeField(blank=True, null=True)),
        migrations.AddField(model_name="issue", name="target_time", field=models.TimeField(blank=True, null=True)),
        migrations.AddField(
            model_name="issue", name="schedule_timezone", field=models.CharField(blank=True, default="", max_length=64)
        ),
    ]
