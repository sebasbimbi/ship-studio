/**
 * Overlay component displayed when a feature requires GitHub or Vercel authentication.
 *
 * Shows a full-tab overlay with service icon, title, description, and connect button.
 *
 * @module components/ConnectOverlay
 */

import { GitHubIcon, VercelIcon } from './icons';

interface ConnectOverlayProps {
  /** The service that needs to be connected */
  service: 'github' | 'vercel';
  /** Title text explaining what connection enables */
  title: string;
  /** Description text with more details */
  description: string;
  /** Called when user clicks the Connect button */
  onConnect: () => void;
  /** Whether connect action is in progress */
  isConnecting?: boolean;
}

export function ConnectOverlay({
  service,
  title,
  description,
  onConnect,
  isConnecting,
}: ConnectOverlayProps) {
  const ServiceIcon = service === 'github' ? GitHubIcon : VercelIcon;
  const serviceName = service === 'github' ? 'GitHub' : 'Vercel';

  return (
    <div className="connect-overlay">
      <div className="connect-overlay-content">
        <div className="connect-overlay-icon">
          <ServiceIcon size={48} />
        </div>
        <h3 className="connect-overlay-title">{title}</h3>
        <p className="connect-overlay-description">{description}</p>
        <button
          className="connect-overlay-btn"
          onClick={onConnect}
          disabled={isConnecting}
        >
          {isConnecting ? 'Connecting...' : `Connect ${serviceName}`}
        </button>
      </div>
    </div>
  );
}
