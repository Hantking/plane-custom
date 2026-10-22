from django.urls import path
from .views import AIEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/ai/", AIEndpoint.as_view()),
    path("workspaces/<str:slug>/ai/<str:resource>/", AIEndpoint.as_view()),
    path("workspaces/<str:slug>/ai/<str:resource>/<uuid:pk>/", AIEndpoint.as_view()),
    path("workspaces/<str:slug>/ai/<str:resource>/<uuid:pk>/<str:command>/", AIEndpoint.as_view()),
]
