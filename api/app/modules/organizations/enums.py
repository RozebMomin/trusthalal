"""Status enum for the Organization verification workflow.

The admin-created path (``admin_create_organization``) marks orgs as
VERIFIED at birth — Trust Halal staff is implicitly trusting itself.
The owner-self-service path starts orgs as DRAFT, lets the owner
attach evidence (articles of organization, business filing, etc.),
and transitions to UNDER_REVIEW on submit. Admin staff verifies or
rejects from there.

Workflow:

    DRAFT ──submit──> UNDER_REVIEW ──verify──> VERIFIED
                              │
                              └──reject──> REJECTED

Once VERIFIED, an org is eligible to be the requesting party on a
claim approval. REJECTED orgs are read-only artifacts; the owner
typically creates a new org rather than re-submitting.
"""

from enum import StrEnum


class OrganizationStatus(StrEnum):
    DRAFT = "DRAFT"
    UNDER_REVIEW = "UNDER_REVIEW"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
