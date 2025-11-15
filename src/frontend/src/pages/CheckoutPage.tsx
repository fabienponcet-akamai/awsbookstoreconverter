import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Button, Form, ListGroup, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchCart } from '../store/slices/cartSlice';
import { createOrder } from '../store/slices/ordersSlice';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';

const CheckoutPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { cart, loading: cartLoading } = useSelector((state: RootState) => state.cart);
  const { loading: orderLoading } = useSelector((state: RootState) => state.orders);
  const { user } = useAuth();

  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    if (user?.sub) {
      dispatch(fetchCart(user.sub));
    }
  }, [dispatch, user]);

  const handlePlaceOrder = async () => {
    if (!user?.sub) {
      toast.error('Please login to place an order');
      return;
    }

    if (!agreedToTerms) {
      toast.error('Please agree to the terms and conditions');
      return;
    }

    if (!cart || cart.items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }

    dispatch(createOrder(user.sub))
      .unwrap()
      .then((order) => {
        toast.success('Order placed successfully!');
        navigate('/orders');
      })
      .catch((error) => {
        toast.error('Failed to place order');
      });
  };

  if (cartLoading) {
    return <LoadingSpinner message="Loading checkout..." />;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <Container className="py-4">
        <Alert variant="warning">
          <Alert.Heading>Cart is Empty</Alert.Heading>
          <p>You need to add items to your cart before checking out.</p>
          <Button variant="primary" onClick={() => navigate('/products')}>
            Go Shopping
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <h1 className="mb-4">Checkout</h1>

      <Row>
        <Col lg={8}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">📧 Contact Information</h5>
            </Card.Header>
            <Card.Body>
              <p><strong>Email:</strong> {user?.email || 'N/A'}</p>
              <p><strong>Name:</strong> {user?.name || user?.preferred_username || 'N/A'}</p>
            </Card.Body>
          </Card>

          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">📦 Shipping Address</h5>
            </Card.Header>
            <Card.Body>
              <Alert variant="info">
                <small>
                  This is a demo application. In production, you would collect shipping address details here.
                </small>
              </Alert>
              <Form>
                <Row>
                  <Col md={6} className="mb-3">
                    <Form.Group>
                      <Form.Label>First Name</Form.Label>
                      <Form.Control type="text" placeholder="John" disabled />
                    </Form.Group>
                  </Col>
                  <Col md={6} className="mb-3">
                    <Form.Group>
                      <Form.Label>Last Name</Form.Label>
                      <Form.Control type="text" placeholder="Doe" disabled />
                    </Form.Group>
                  </Col>
                </Row>
                <Form.Group className="mb-3">
                  <Form.Label>Address</Form.Label>
                  <Form.Control type="text" placeholder="123 Main St" disabled />
                </Form.Group>
                <Row>
                  <Col md={6} className="mb-3">
                    <Form.Group>
                      <Form.Label>City</Form.Label>
                      <Form.Control type="text" placeholder="New York" disabled />
                    </Form.Group>
                  </Col>
                  <Col md={3} className="mb-3">
                    <Form.Group>
                      <Form.Label>State</Form.Label>
                      <Form.Control type="text" placeholder="NY" disabled />
                    </Form.Group>
                  </Col>
                  <Col md={3} className="mb-3">
                    <Form.Group>
                      <Form.Label>ZIP</Form.Label>
                      <Form.Control type="text" placeholder="10001" disabled />
                    </Form.Group>
                  </Col>
                </Row>
              </Form>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header>
              <h5 className="mb-0">💳 Payment Method</h5>
            </Card.Header>
            <Card.Body>
              <Alert variant="info">
                <small>
                  This is a demo application. In production, you would integrate a payment gateway here.
                </small>
              </Alert>
              <Form.Check
                type="radio"
                label="Credit Card (Demo)"
                name="payment"
                defaultChecked
                disabled
              />
            </Card.Body>
          </Card>
        </Col>

        <Col lg={4}>
          <Card className="mb-3">
            <Card.Header>
              <h5 className="mb-0">Order Summary</h5>
            </Card.Header>
            <ListGroup variant="flush">
              {cart.items.map((item) => (
                <ListGroup.Item key={item.productId} className="d-flex justify-content-between">
                  <div>
                    <div className="fw-bold">{item.product.title}</div>
                    <small className="text-muted">Qty: {item.quantity}</small>
                  </div>
                  <span>${(item.price * item.quantity).toFixed(2)}</span>
                </ListGroup.Item>
              ))}
            </ListGroup>
            <Card.Body>
              <div className="d-flex justify-content-between mb-2">
                <span>Subtotal:</span>
                <strong>${cart.total.toFixed(2)}</strong>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span>Shipping:</span>
                <strong>FREE</strong>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span>Tax:</span>
                <strong>${(cart.total * 0.1).toFixed(2)}</strong>
              </div>
              <hr />
              <div className="d-flex justify-content-between mb-3">
                <strong>Total:</strong>
                <strong className="text-primary">${(cart.total * 1.1).toFixed(2)}</strong>
              </div>

              <Form.Check
                type="checkbox"
                label="I agree to the terms and conditions"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mb-3"
              />

              <Button
                variant="primary"
                size="lg"
                className="w-100"
                onClick={handlePlaceOrder}
                disabled={!agreedToTerms || orderLoading}
              >
                {orderLoading ? 'Processing...' : 'Place Order'}
              </Button>

              <Button
                variant="outline-secondary"
                className="w-100 mt-2"
                onClick={() => navigate('/cart')}
                disabled={orderLoading}
              >
                Back to Cart
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default CheckoutPage;
