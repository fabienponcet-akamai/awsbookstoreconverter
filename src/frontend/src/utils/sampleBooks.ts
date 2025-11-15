// Sample book data generator for demo purposes
// In production, this data comes from the API

export const generateSampleBookCover = (bookId: string, title: string): string => {
  const colors = [
    '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#34495e', '#e67e22'
  ];

  const color = colors[bookId.charCodeAt(0) % colors.length];
  const initials = title
    .split(' ')
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();

  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='300'%3E%3Crect width='200' height='300' fill='${encodeURIComponent(color)}'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-size='60' font-weight='bold'%3E${initials}%3C/text%3E%3C/svg%3E`;
};
