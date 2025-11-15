import React from 'react';
import { Alert, Button } from 'react-bootstrap';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onRetry }) => {
  return (
    <Alert variant="danger" className="error-message">
      <Alert.Heading>Oops! Something went wrong</Alert.Heading>
      <p>{message}</p>
      {onRetry && (
        <div className="mt-3">
          <Button variant="outline-danger" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      )}
    </Alert>
  );
};

export default ErrorMessage;
