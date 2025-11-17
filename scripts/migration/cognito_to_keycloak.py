#!/usr/bin/env python3
"""
Transform AWS Cognito users to Keycloak import format

Usage:
  # Export from Cognito
  aws cognito-idp list-users \
    --user-pool-id us-east-1_XXXXXXXXX \
    --max-results 60 > cognito-users.json

  # Transform for Keycloak
  python cognito_to_keycloak.py \
    --input cognito-users.json \
    --output keycloak-users.json \
    --realm bookstore
"""
import json
import sys
import argparse
from typing import List, Dict, Any
from datetime import datetime


def transform_cognito_user(cognito_user: Dict[str, Any], realm: str) -> Dict[str, Any]:
    """
    Transform single Cognito user to Keycloak format

    Note: Cognito passwords cannot be exported for security reasons.
    Users will be required to reset their password on first login.
    """

    # Extract attributes from Cognito format
    attributes = {attr['Name']: attr['Value']
                 for attr in cognito_user.get('Attributes', [])}

    # Map Cognito user status to Keycloak enabled flag
    enabled = cognito_user.get('UserStatus') == 'CONFIRMED' and \
              cognito_user.get('Enabled', True)

    # Extract user metadata
    username = cognito_user.get('Username', '')
    created_date = cognito_user.get('UserCreateDate', '')
    modified_date = cognito_user.get('UserLastModifiedDate', '')

    # Parse timestamps (Cognito uses Unix timestamp in seconds)
    if isinstance(created_date, (int, float)):
        created_timestamp = int(created_date * 1000)  # Convert to milliseconds
    else:
        created_timestamp = int(datetime.now().timestamp() * 1000)

    if isinstance(modified_date, (int, float)):
        modified_timestamp = int(modified_date * 1000)
    else:
        modified_timestamp = created_timestamp

    # Build Keycloak user object
    keycloak_user = {
        "username": username,
        "email": attributes.get('email', ''),
        "emailVerified": attributes.get('email_verified', 'false').lower() == 'true',
        "enabled": enabled,
        "firstName": attributes.get('given_name', ''),
        "lastName": attributes.get('family_name', ''),
        "createdTimestamp": created_timestamp,

        # Custom attributes
        "attributes": {
            "cognito_sub": [attributes.get('sub', '')],
            "phone_number": [attributes.get('phone_number', '')],
            "phone_number_verified": [attributes.get('phone_number_verified', 'false')],
            "locale": [attributes.get('locale', 'en')],
            "migrated_from_cognito": ["true"],
            "migration_date": [datetime.now().isoformat()]
        },

        # Password management
        "credentials": [],  # Passwords cannot be migrated from Cognito

        # Force password reset on first login
        "requiredActions": ["UPDATE_PASSWORD"],

        # Groups/roles (extract from Cognito groups if available)
        "groups": [],
        "realmRoles": ["user"],  # Default role

        # Client roles
        "clientRoles": {
            "bookstore-frontend": ["customer"]
        }
    }

    # Handle Cognito groups (if user has cognito:groups attribute)
    cognito_groups = attributes.get('cognito:groups', '')
    if cognito_groups:
        # cognito:groups might be comma-separated
        groups = [g.strip() for g in cognito_groups.split(',')]
        keycloak_user['groups'] = [f"/{g}" for g in groups]

        # Map Cognito groups to Keycloak roles
        if 'admin' in groups or 'Admin' in groups:
            keycloak_user['realmRoles'].append('admin')
            keycloak_user['clientRoles']['bookstore-frontend'].append('admin')

    # Remove empty attributes
    if not keycloak_user['firstName']:
        del keycloak_user['firstName']
    if not keycloak_user['lastName']:
        del keycloak_user['lastName']
    if not keycloak_user['email']:
        del keycloak_user['email']

    # Clean up empty attribute values
    keycloak_user['attributes'] = {
        k: v for k, v in keycloak_user['attributes'].items()
        if v and v[0]
    }

    return keycloak_user


def main():
    parser = argparse.ArgumentParser(description='Transform Cognito users to Keycloak format')
    parser.add_argument('--input', required=True,
                       help='Input Cognito users JSON file')
    parser.add_argument('--output', required=True,
                       help='Output Keycloak import JSON file')
    parser.add_argument('--realm', default='bookstore',
                       help='Keycloak realm name (default: bookstore)')
    parser.add_argument('--export-realm', action='store_true',
                       help='Export complete realm configuration (not just users)')

    args = parser.parse_args()

    # Read Cognito export
    try:
        with open(args.input, 'r', encoding='utf-8') as f:
            cognito_data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Input file not found: {args.input}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Invalid JSON in {args.input}: {e}")
        sys.exit(1)

    # Extract users array
    cognito_users = cognito_data.get('Users', [])
    if not cognito_users:
        print(f"⚠️  No users found in {args.input}")
        sys.exit(0)

    print(f"📦 Loaded {len(cognito_users)} users from Cognito")

    # Transform users
    keycloak_users = []
    errors = []

    for i, cognito_user in enumerate(cognito_users, 1):
        try:
            keycloak_user = transform_cognito_user(cognito_user, args.realm)
            keycloak_users.append(keycloak_user)

            if i % 100 == 0:
                print(f"  ✓ Transformed {i}/{len(cognito_users)} users...")

        except Exception as e:
            username = cognito_user.get('Username', 'unknown')
            error_msg = f"Failed to transform user {username}: {e}"
            errors.append(error_msg)
            print(f"  ⚠️  {error_msg}")

    # Build output structure
    if args.export_realm:
        # Full realm export format (can be imported via Keycloak Admin Console)
        output = {
            "realm": args.realm,
            "enabled": True,
            "users": keycloak_users,
            "groups": [
                {
                    "name": "customers",
                    "path": "/customers"
                },
                {
                    "name": "admins",
                    "path": "/admins"
                }
            ],
            "roles": {
                "realm": [
                    {"name": "user", "description": "User role"},
                    {"name": "admin", "description": "Administrator role"}
                ],
                "client": {
                    "bookstore-frontend": [
                        {"name": "customer", "description": "Customer role"},
                        {"name": "admin", "description": "Admin role"}
                    ]
                }
            },
            "clients": [
                {
                    "clientId": "bookstore-frontend",
                    "enabled": True,
                    "publicClient": True,
                    "redirectUris": [
                        "https://bookstore.example.com/*",
                        "http://localhost:3000/*"
                    ],
                    "webOrigins": [
                        "https://bookstore.example.com",
                        "http://localhost:3000"
                    ]
                }
            ]
        }
    else:
        # Users-only export (for partial import)
        output = {
            "realm": args.realm,
            "users": keycloak_users
        }

    # Write output
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"\n✅ Transformation completed!")
    print(f"   📊 Successfully transformed: {len(keycloak_users)} users")
    print(f"   ❌ Failed transformations: {len(errors)}")
    print(f"   📄 Output: {args.output}")

    if errors:
        print(f"\n⚠️  Errors encountered:")
        for error in errors[:10]:  # Show first 10 errors
            print(f"   - {error}")
        if len(errors) > 10:
            print(f"   ... and {len(errors) - 10} more errors")

    # Print import instructions
    print(f"\n📥 Import instructions:")
    print(f"\n1. Via Keycloak Admin API:")
    print(f"   KC_TOKEN=$(curl -X POST 'https://auth.bookstore.example.com/realms/master/protocol/openid-connect/token' \\")
    print(f"     -d 'client_id=admin-cli' \\")
    print(f"     -d 'username=admin' \\")
    print(f"     -d 'password=$KC_ADMIN_PASSWORD' \\")
    print(f"     -d 'grant_type=password' | jq -r '.access_token')")
    print(f"\n   jq -c '.users[]' {args.output} | while read user; do")
    print(f"     curl -X POST 'https://auth.bookstore.example.com/admin/realms/{args.realm}/users' \\")
    print(f"       -H 'Authorization: Bearer $KC_TOKEN' \\")
    print(f"       -H 'Content-Type: application/json' \\")
    print(f"       -d \"$user\"")
    print(f"   done")

    if args.export_realm:
        print(f"\n2. Via Keycloak Admin Console:")
        print(f"   - Navigate to: https://auth.bookstore.example.com/admin")
        print(f"   - Select realm: {args.realm}")
        print(f"   - Manage → Import")
        print(f"   - Upload: {args.output}")
        print(f"   - Select: 'Overwrite' or 'Skip' for existing users")

    print(f"\n⚠️  IMPORTANT: Users will need to reset their passwords!")
    print(f"   Cognito passwords cannot be exported for security reasons.")
    print(f"   All users have 'UPDATE_PASSWORD' required action.")

    # Return exit code based on success
    if len(keycloak_users) == len(cognito_users):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
