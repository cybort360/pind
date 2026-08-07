import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="boot-screen">
      <div className="brand-mark brand-mark--large">?</div>
      <h1>This page could not be found.</h1>
      <p>The link may be old, the project may have been removed, or the address is incorrect.</p>
      <Link to="/" className="button button--primary"><ArrowLeft size={15} /> Back to Pind</Link>
    </div>
  );
}