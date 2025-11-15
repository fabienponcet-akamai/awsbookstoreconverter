import { useKeycloak } from '@react-keycloak/web';
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setUser, clearUser } from '../store/slices/userSlice';

export const useAuth = () => {
  const { keycloak, initialized } = useKeycloak();
  const dispatch = useDispatch();

  useEffect(() => {
    if (initialized && keycloak.authenticated && keycloak.tokenParsed) {
      const user = {
        id: keycloak.tokenParsed.sub || '',
        email: keycloak.tokenParsed.email || '',
        name: keycloak.tokenParsed.name || '',
        username: keycloak.tokenParsed.preferred_username || '',
      };
      dispatch(setUser(user));
    } else if (initialized && !keycloak.authenticated) {
      dispatch(clearUser());
    }
  }, [initialized, keycloak.authenticated, keycloak.tokenParsed, dispatch]);

  return {
    isAuthenticated: keycloak.authenticated || false,
    user: keycloak.tokenParsed,
    login: () => keycloak.login(),
    logout: () => keycloak.logout(),
    register: () => keycloak.register(),
    initialized,
  };
};
