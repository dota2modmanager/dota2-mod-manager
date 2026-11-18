/* The upload terms, shown once as the catalog's site shows them. Kept apart from the author's
 * window so that window stays a readable size. */
import { createPortal } from 'react-dom';

export function Consent({ busy, onAccept }: { busy: boolean; onAccept: () => void }) {
  return createPortal(
    <div className="creator-consent-scrim">
      <div className="creator-consent" role="dialog" aria-modal="true" aria-labelledby="creatorConsentTitle">
        <div className="modal-title" id="creatorConsentTitle"><span className="ms">gavel</span>{L`Перед загрузкой`}</div>
        <p>{L`Моды, отправленные из приложения, публикуются в каталоге D2PFX. Отправляя мод, ты подтверждаешь, что:`}</p>
        <ul>
          <li>{L`ты автор мода или вправе его распространять, и в нём нет чужой работы без разрешения;`}</li>
          <li>{L`каталог может бесплатно хранить и раздавать мод, а он выходит под Content License каталога;`}</li>
          <li>{L`автор каталога может отправлять жалобы на нелегальные копии, зеркала и платные перепродажи;`}</li>
          <li>{L`все права на мод остаются у тебя, и ты можешь попросить изменить или удалить его в любое время;`}</li>
          <li>{L`ресурсы Valve внутри мода остаются собственностью Valve.`}</li>
        </ul>
        <p className="text-meta">{L`Ник, дата и технический отпечаток отправки записываются в публичном pull request каталога.`}</p>
        <div className="modal-actions">
          <button className="btn btn-primary" id="creatorConsentBtn" disabled={busy} onClick={onAccept}>{L`Принимаю условия`}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
