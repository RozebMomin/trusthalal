from enum import StrEnum

class UserRole(StrEnum):
    ADMIN = "ADMIN"
    OWNER = "OWNER"
    VERIFIER = "VERIFIER"
    CONSUMER = "CONSUMER"