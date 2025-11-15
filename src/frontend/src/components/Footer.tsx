import React from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-dark text-light py-4 mt-5">
      <Container>
        <Row>
          <Col md={4}>
            <h5>📚 Bookstore</h5>
            <p className="text-muted">
              Your online destination for discovering and purchasing great books.
            </p>
          </Col>
          <Col md={4}>
            <h5>Quick Links</h5>
            <ul className="list-unstyled">
              <li><Link to="/" className="text-light text-decoration-none">Home</Link></li>
              <li><Link to="/products" className="text-light text-decoration-none">Browse Books</Link></li>
              <li><Link to="/cart" className="text-light text-decoration-none">Shopping Cart</Link></li>
              <li><Link to="/orders" className="text-light text-decoration-none">My Orders</Link></li>
            </ul>
          </Col>
          <Col md={4}>
            <h5>About</h5>
            <p className="text-muted">
              Migrated from AWS to Akamai App Platform<br />
              Powered by Knative, Istio, and CloudNative-PG
            </p>
          </Col>
        </Row>
        <Row className="mt-3">
          <Col className="text-center text-muted">
            <small>&copy; {currentYear} Bookstore. All rights reserved.</small>
          </Col>
        </Row>
      </Container>
    </footer>
  );
};

export default Footer;
