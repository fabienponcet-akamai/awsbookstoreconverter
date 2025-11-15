import React, { useEffect } from 'react';
import { Container, Card, Badge, ListGroup } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchOrders } from '../store/slices/ordersSlice';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../hooks/useAuth';
import { OrderStatus } from '../types';

const OrdersPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { orders, loading, error } = useSelector((state: RootState) => state.orders);
  const { user } = useAuth();

  useEffect(() => {
    if (user?.sub) {
      dispatch(fetchOrders(user.sub));
    }
  }, [dispatch, user]);

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.COMPLETED:
        return 'success';
      case OrderStatus.PROCESSING:
        return 'primary';
      case OrderStatus.CANCELLED:
        return 'danger';
      default:
        return 'secondary';
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading your orders..." />;
  }

  if (error) {
    return (
      <Container className="py-4">
        <ErrorMessage message={error} onRetry={() => user?.sub && dispatch(fetchOrders(user.sub))} />
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <h1 className="mb-4">📦 My Orders</h1>

      {orders.length === 0 ? (
        <div className="empty-state">
          <h3>No orders yet</h3>
          <p>When you place orders, they will appear here</p>
        </div>
      ) : (
        <div>
          {orders.map((order) => (
            <Card key={order.id} className="mb-3">
              <Card.Header className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>Order #{order.id.substring(0, 8)}</strong>
                  <div className="text-muted small">
                    {new Date(order.createdAt).toLocaleString()}
                  </div>
                </div>
                <Badge bg={getStatusVariant(order.status)}>{order.status}</Badge>
              </Card.Header>
              <Card.Body>
                <ListGroup variant="flush">
                  {order.items.map((item, index) => (
                    <ListGroup.Item key={index} className="d-flex justify-content-between">
                      <div>
                        <div className="fw-bold">{item.title}</div>
                        <small className="text-muted">by {item.author}</small>
                        <div className="text-muted small">Quantity: {item.quantity}</div>
                      </div>
                      <div className="text-end">
                        <div>${item.price.toFixed(2)}</div>
                        <small className="text-muted">each</small>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
                <div className="text-end mt-3">
                  <strong className="text-primary h5">
                    Total: ${order.total.toFixed(2)}
                  </strong>
                </div>
              </Card.Body>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
};

export default OrdersPage;
