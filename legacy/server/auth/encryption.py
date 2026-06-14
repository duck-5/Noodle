"""
Fernet-based symmetric encryption for sensitive user data.

Used to encrypt Moodle tokens and SSO credentials at rest in the CSV database.
The encryption key is derived from SERVER_SECRET.
"""

import base64
import hashlib
from cryptography.fernet import Fernet

from server.config import SERVER_SECRET


def _get_fernet() -> Fernet:
    """Derive a Fernet key from SERVER_SECRET.

    Fernet requires a 32-byte URL-safe base64-encoded key.
    We derive it deterministically from the server secret via SHA-256.
    """
    key_bytes = hashlib.sha256(SERVER_SECRET.encode()).digest()
    key_b64 = base64.urlsafe_b64encode(key_bytes)
    return Fernet(key_b64)


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext string (e.g. Moodle token) and return the
    ciphertext as a URL-safe base64 string.

    Args:
        plaintext: The sensitive value to encrypt.

    Returns:
        Encrypted ciphertext string.
    """
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a ciphertext string back to the original plaintext.

    Args:
        ciphertext: The encrypted value from the database.

    Returns:
        Original plaintext string.

    Raises:
        cryptography.fernet.InvalidToken: If the ciphertext is corrupt or
        the SERVER_SECRET has changed since encryption.
    """
    f = _get_fernet()
    return f.decrypt(ciphertext.encode()).decode()
