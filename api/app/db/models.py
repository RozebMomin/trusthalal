# app/db/models.py
# Import all SQLAlchemy models so Base.metadata is fully populated.

from app.modules.auth.models import Session  # noqa: F401
from app.modules.places.models import Place, PlaceExternalId  # noqa: F401
from app.modules.users.models import User  # noqa: F401
from app.modules.organizations.models import (  # noqa: F401
    Organization,
    OrganizationAttachment,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.ownership_requests.models import (  # noqa: F401
    OwnershipRequestAttachment,
    PlaceOwnershipRequest,
)

# Halal v2 — see api/alembic/versions/h1a2b3c4d5e6_halal_v2_schema.py
# for the migration that creates these tables. The legacy
# ``app.modules.claims`` and ``app.modules.admin.claims`` modules were
# removed alongside that migration; this file is the new single
# source of truth for "what models does Base.metadata know about?"
from app.modules.halal_claims.models import (  # noqa: F401
    HalalClaim,
    HalalClaimAttachment,
)
from app.modules.halal_profiles.models import (  # noqa: F401
    HalalProfile,
    HalalProfileEvent,
)
from app.modules.disputes.models import (  # noqa: F401
    ConsumerDispute,
    ConsumerDisputeAttachment,
)
from app.modules.verifiers.models import (  # noqa: F401
    VerificationVisit,
    VerificationVisitAttachment,
    VerifierApplication,
    VerifierProfile,
)
