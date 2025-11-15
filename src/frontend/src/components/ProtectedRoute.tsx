import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Spinner, Container } from 'react-bootstrap';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, initialized, login } = useAuth();

  if (!initialized) {
    return (
      <Container className="text-center my-5">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
        <p className="mt-3">Initializing authentication...</p>
      </Container>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login
    login();
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
