# app/db/models.py
# Import all SQLAlchemy models so Base.metadata is fully populated.

from app.modules.auth.models import Session  # noqa: F401
from app.modules.places.models import Place, PlaceExternalId  # noqa: F401
from app.modules.users.models import User  # noqa: F401
from app.modules.organizations.models import Organization, PlaceOwner, OrganizationMember  # noqa: F401
from app.modules.claims.models import HalalClaim, Evidence, ClaimEvent  # noqa: F401
from app.modules.ownership_requests.models import (  # noqa: F401
    OwnershipRequestAttachment,
    PlaceOwnershipRequest,
)