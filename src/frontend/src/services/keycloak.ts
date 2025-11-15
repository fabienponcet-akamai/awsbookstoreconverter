import Keycloak from 'keycloak-js';

const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'bookstore',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'bookstore-frontend',
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;
