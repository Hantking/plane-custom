from django.urls import include, path

urlpatterns = [path("api/", include("plane.ai.urls")), path("api/", include("plane.custom_fields.urls"))]
