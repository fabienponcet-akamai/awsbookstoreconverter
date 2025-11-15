import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
  onAddToCart?: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onAddToCart }) => {
  const defaultImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300"%3E%3Crect width="200" height="300" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="20"%3ENo Image%3C/text%3E%3C/svg%3E';

  return (
    <Card className="h-100 product-card">
      <Link to={`/products/${product.id}`} className="text-decoration-none">
        <Card.Img
          variant="top"
          src={product.coverImage || defaultImage}
          alt={product.title}
          style={{ height: '300px', objectFit: 'cover' }}
        />
      </Link>
      <Card.Body className="d-flex flex-column">
        <Card.Title className="text-truncate" title={product.title}>
          <Link to={`/products/${product.id}`} className="text-dark text-decoration-none">
            {product.title}
          </Link>
        </Card.Title>
        <Card.Subtitle className="mb-2 text-muted text-truncate" title={product.author}>
          {product.author}
        </Card.Subtitle>
        <Card.Text className="text-muted small">
          {product.category}
        </Card.Text>
        <div className="mt-auto">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <span className="h5 mb-0 text-primary">${product.price.toFixed(2)}</span>
            {product.rating && (
              <span className="text-warning">
                {'⭐'.repeat(Math.round(product.rating))}
              </span>
            )}
          </div>
          {onAddToCart && (
            <Button
              variant="primary"
              className="w-100"
              onClick={(e) => {
                e.preventDefault();
                onAddToCart(product);
              }}
            >
              Add to Cart
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default ProductCard;
