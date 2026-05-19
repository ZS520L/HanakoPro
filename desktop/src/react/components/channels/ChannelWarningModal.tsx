import { useI18n } from '../../hooks/use-i18n';
import { Overlay } from '../../ui';

interface ChannelWarningModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChannelWarningModal({ open, onConfirm, onCancel }: ChannelWarningModalProps) {
  const { t } = useI18n();

  const bodyText = t('channel.warningBody') || '';
  const paragraphs = bodyText.split('\n\n');

  return (
    <Overlay
      open={open}
      onClose={onCancel}
      backdrop="dim"
      closeOnBackdrop={false}
      closeOnEsc={false}
      zIndex={9999}
      className="hana-warning-box"
      disableContainerAnimation
    >
      <h3 className="hana-warning-title">{t('channel.warningTitle')}</h3>
      <div className="hana-warning-body">
        {paragraphs.map((para, i) => {
          const lines = para.split('\n');
          return (
            <p key={`warning-para-${i}`}>
              {lines.map((line, j) => (
                j === 0
                  ? <span key={`warning-line-${i}-${j}`}>{line}</span>
                  : <span key={`warning-line-${i}-${j}`}><br />{line}</span>
              ))}
            </p>
          );
        })}
      </div>
      <div className="hana-warning-actions">
        <button className="hana-warning-cancel" onClick={onCancel}>
          {t('channel.createCancel')}
        </button>
        <button className="hana-warning-confirm" onClick={onConfirm}>
          {t('channel.warningConfirm')}
        </button>
      </div>
    </Overlay>
  );
}
