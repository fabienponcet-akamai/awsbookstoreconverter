import { IEventHandler, OutboxEvent } from '../outbox-event-router';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SearchSyncHandler');

// OpenSearch client (would import from opensearch library in production)
// import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

// For now, we'll mock the client - replace with real implementation
const searchClient = {
  async index(params: any) {
    logger.debug(`  [Search] Index: ${JSON.stringify(params)}`);
  },
  async update(params: any) {
    logger.debug(`  [Search] Update: ${JSON.stringify(params)}`);
  },
  async delete(params: any) {
    logger.debug(`  [Search] Delete: ${JSON.stringify(params)}`);
  }
};

/**
 * Search Sync Handler
 *
 * Syncs book data to OpenSearch for full-text search capabilities
 *
 * Handles:
 * - book_created → Index new book
 * - book_updated → Update existing book
 * - book_deleted → Remove from index
 */
export class SearchSyncHandler implements IEventHandler {
  name = 'SearchSyncHandler';
  supportedEvents = ['book_created', 'book_updated', 'book_deleted'];

  async handle(event: OutboxEvent): Promise<void> {
    const { event_type, payload } = event;

    switch (event_type) {
      case 'book_created':
      case 'book_updated':
        await this.indexBook(payload);
        break;

      case 'book_deleted':
        await this.deleteBook(payload.id);
        break;

      default:
        logger.warn(`Unexpected event type: ${event_type}`);
    }
  }

  /**
   * Index or update a book in OpenSearch
   */
  private async indexBook(book: any): Promise<void> {
    await searchClient.index({
      index: 'books',
      id: book.id,
      body: {
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        category: book.category || 'General',
        price: book.price,
        description: book.description || '',
        cover_url: book.cover_url || '',

        // Combined search field for better full-text search
        search_text: [
          book.title,
          book.author,
          book.category || '',
          book.isbn,
          book.description || ''
        ].join(' ').toLowerCase(),

        indexed_at: new Date().toISOString()
      }
    });

    logger.info(`✅ SearchSync: Indexed book ${book.id} (${book.title})`);
  }

  /**
   * Delete a book from OpenSearch index
   */
  private async deleteBook(bookId: string): Promise<void> {
    try {
      await searchClient.delete({
        index: 'books',
        id: bookId
      });

      logger.info(`✅ SearchSync: Deleted book ${bookId}`);
    } catch (error) {
      // Ignore 404 errors (book already deleted)
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
        logger.debug(`Book ${bookId} not found in search index (already deleted)`);
      } else {
        throw error;
      }
    }
  }
}
