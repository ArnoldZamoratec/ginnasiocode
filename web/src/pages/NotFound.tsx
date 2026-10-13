import { Link } from 'react-router-dom';
import { Empty } from '../components/ui.tsx';

export function NotFound() {
  return (
    <div className="page narrow">
      <Empty glyph="404" title="Esta página no existe" action={<Link className="btn" to="/">Volver al inicio</Link>}>
        Revisa el enlace o vuelve al inicio desde el menú.
      </Empty>
    </div>
  );
}
