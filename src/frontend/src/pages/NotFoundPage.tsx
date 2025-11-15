import React from 'react';
import { Container, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';

const NotFoundPage: React.FC = () => {
  return (
    <Container className="py-5">
      <div className="text-center">
        <h1 className="display-1">404</h1>
        <h2 className="mb-4">Page Not Found</h2>
        <p className="lead mb-4">
          Sorry, the page you're looking for doesn't exist.
        </p>
        <Button as={Link} to="/" variant="primary" size="lg">
          Go Home
        </Button>
      </div>
    </Container>
  );
};

export default NotFoundPage;
