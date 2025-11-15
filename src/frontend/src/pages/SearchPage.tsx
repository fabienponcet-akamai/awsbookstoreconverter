import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Form, Button } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { addToCart } from '../store/slices/cartSlice';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';
import { Product } from '../types';

const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useAuth();

  const queryParam = searchParams.get('q') || '';
  const [query, setQuery] = useState(queryParam);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (queryParam) {
      performSearch(queryParam);
    }
  }, [queryParam]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.search(searchQuery);
      setResults(data.products || data || []);
    } catch (err) {
      setError('Failed to search products');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query });
    }
  };

  const handleAddToCart = (product: Product) => {
    if (!isAuthenticated || !user?.sub) {
      toast.error('Please login to add items to cart');
      return;
    }

    dispatch(addToCart({
      userId: user.sub,
      productId: product.id,
      quantity: 1,
    }))
      .unwrap()
      .then(() => {
        toast.success(`${product.title} added to cart!`);
      })
      .catch(() => {
        toast.error('Failed to add item to cart');
      });
  };

  return (
    <Container className="py-4">
      <h1 className="mb-4">🔍 Search Books</h1>

      <Form onSubmit={handleSearch} className="mb-4">
        <Row>
          <Col md={10}>
            <Form.Control
              type="search"
              placeholder="Search by title, author, or category..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size="lg"
            />
          </Col>
          <Col md={2}>
            <Button variant="primary" type="submit" size="lg" className="w-100">
              Search
            </Button>
          </Col>
        </Row>
      </Form>

      {loading && <LoadingSpinner message="Searching..." />}

      {error && <ErrorMessage message={error} onRetry={() => performSearch(queryParam)} />}

      {!loading && !error && queryParam && (
        <>
          <div className="mb-3 text-muted">
            {results.length > 0 ? (
              <>Showing {results.length} {results.length === 1 ? 'result' : 'results'} for "<strong>{queryParam}</strong>"</>
            ) : (
              <>No results found for "<strong>{queryParam}</strong>"</>
            )}
          </div>

          {results.length > 0 && (
            <Row>
              {results.map((product) => (
                <Col key={product.id} sm={6} md={4} lg={3} className="mb-4">
                  <ProductCard product={product} onAddToCart={handleAddToCart} />
                </Col>
              ))}
            </Row>
          )}
        </>
      )}

      {!queryParam && !loading && (
        <div className="empty-state">
          <h3>Search for books</h3>
          <p>Enter a search term above to find books by title, author, or category</p>
        </div>
      )}
    </Container>
  );
};

export default SearchPage;
