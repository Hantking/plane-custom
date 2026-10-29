from django.urls import path
from .list_api import NativeListOperations
from .views import (
    BatchValuesEndpoint,
    FieldEndpoint,
    FieldsEndpoint,
    ItemsEndpoint,
    ValuesEndpoint,
    ViewEndpoint,
    ViewsEndpoint,
)
from .native import NativeDisplayEndpoint, NativeValuesEndpoint
from .module_states import ModuleStatesEndpoint
from .personal_pages import PersonalPagesEndpoint

prefix = "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/"
urlpatterns = [
    path("workspaces/<str:slug>/personal-pages/", PersonalPagesEndpoint.as_view()),
    path("workspaces/<str:slug>/projects/<uuid:project_id>/module-states/", ModuleStatesEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/module-states/<uuid:module_id>/",
        ModuleStatesEndpoint.as_view(),
    ),
    path("workspaces/<str:slug>/custom-fields/native-list/<str:operation>/", NativeListOperations.as_view()),
    path("workspaces/<str:slug>/custom-fields/native-display/", NativeDisplayEndpoint.as_view()),
    path("workspaces/<str:slug>/custom-fields/native-values/", NativeValuesEndpoint.as_view()),
    path(prefix, FieldsEndpoint.as_view()),
    path(prefix + "definitions/<uuid:field_id>/", FieldEndpoint.as_view()),
    path(prefix + "issues/<uuid:issue_id>/", ValuesEndpoint.as_view()),
    path(prefix + "items/", ItemsEndpoint.as_view()),
    path(prefix + "values/", BatchValuesEndpoint.as_view()),
    path(prefix + "views/", ViewsEndpoint.as_view()),
    path(prefix + "views/<uuid:view_id>/", ViewEndpoint.as_view()),
]
