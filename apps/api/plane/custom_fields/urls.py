from django.urls import path
from .views import (
    BatchValuesEndpoint,
    FieldEndpoint,
    FieldsEndpoint,
    ItemsEndpoint,
    ValuesEndpoint,
    ViewEndpoint,
    ViewsEndpoint,
)

prefix = "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/"
urlpatterns = [
    path(prefix, FieldsEndpoint.as_view()),
    path(prefix + "definitions/<uuid:field_id>/", FieldEndpoint.as_view()),
    path(prefix + "issues/<uuid:issue_id>/", ValuesEndpoint.as_view()),
    path(prefix + "items/", ItemsEndpoint.as_view()),
    path(prefix + "values/", BatchValuesEndpoint.as_view()),
    path(prefix + "views/", ViewsEndpoint.as_view()),
    path(prefix + "views/<uuid:view_id>/", ViewEndpoint.as_view()),
]
