import type { LinkPreview } from "@sendtomyself/shared";

/** 链接预览卡（meta.preview，SPEC §7）。封面/标题/描述/域名。 */
export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const valid = (s?: string) => (s && /^https?:\/\//.test(s) ? s : undefined);
  const image = valid(preview.image);
  const favicon = valid(preview.favicon);
  return (
    <a className="preview" href={preview.url} target="_blank" rel="noreferrer">
      {image && (
        <div className="preview__cover">
          <img src={image} alt="" loading="lazy" />
        </div>
      )}
      <div className="preview__body">
        <span className="preview__domain">
          {favicon && <img className="preview__favicon" src={favicon} alt="" />}
          {preview.domain ?? preview.url}
        </span>
        {preview.title && <span className="preview__title">{preview.title}</span>}
        {preview.description && (
          <span className="preview__desc">{preview.description}</span>
        )}
      </div>
    </a>
  );
}
