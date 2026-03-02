<script lang="ts">
  import Icon from "@iconify/svelte";
  import QRCode from "qrcode";
  import { onMount } from "svelte";
  import I18nKey from "../../i18n/i18nKey";
  import { i18n } from "../../i18n/translation";
  import {
    type LayoutDimensions,
    type PosterAssets,
    drawRoundedRect,
    getLines,
    loadImage,
    parseDate,
  } from "@utils/poster-canvas-utils";

  export let title: string;
  export let author: string;
  export let description = "";
  export let pubDate: string;
  export let coverImage: string | null = null;
  export let url: string;
  export let siteTitle: string;
  export let avatar: string | null = null;

  // 常量配置
  const SCALE = 2;
  const WIDTH = 425 * SCALE;
  const PADDING = 24 * SCALE;
  const CONTENT_WIDTH = WIDTH - PADDING * 2;
  const FONT_FAMILY = "'Roboto', sans-serif";

  // 组件状态
  let showModal = false;
  let posterImage: string | null = null;
  let themeColor = "#558e88";

  onMount(() => {
    const temp = document.createElement("div");
    temp.style.color = "var(--primary)";
    temp.style.display = "none";
    document.body.appendChild(temp);
    const computedColor = getComputedStyle(temp).color;
    document.body.removeChild(temp);

    if (computedColor) {
      themeColor = computedColor;
    }
  });

  async function loadPosterAssets(qrCodeUrl: string): Promise<PosterAssets> {
    const [qrImg, coverImg, avatarImg] = await Promise.all([
      loadImage(qrCodeUrl),
      coverImage ? loadImage(coverImage) : Promise.resolve(null),
      avatar ? loadImage(avatar) : Promise.resolve(null),
    ]);
    return { qrImg, coverImg, avatarImg };
  }

  function computeLayout(ctx: CanvasRenderingContext2D): LayoutDimensions {
    const coverHeight = (coverImage ? 200 : 120) * SCALE;
    const titleFontSize = 24 * SCALE;
    const descFontSize = 14 * SCALE;
    const qrSize = 80 * SCALE;
    const footerHeight = qrSize;

    ctx.font = `700 ${titleFontSize}px ${FONT_FAMILY}`;
    const titleLines = getLines(ctx, title, CONTENT_WIDTH);
    const titleLineHeight = 30 * SCALE;
    const titleHeight = titleLines.length * titleLineHeight;

    let descHeight = 0;
    if (description) {
      ctx.font = `${descFontSize}px ${FONT_FAMILY}`;
      const descLines = getLines(ctx, description, CONTENT_WIDTH - 16 * SCALE);
      descHeight = Math.min(descLines.length, 6) * (25 * SCALE);
    }

    const canvasHeight =
      coverHeight +
      PADDING +
      titleHeight +
      16 * SCALE +
      descHeight +
      (description ? 24 * SCALE : 8 * SCALE) +
      24 * SCALE +
      footerHeight +
      PADDING;

    return {
      coverHeight,
      titleFontSize,
      descFontSize,
      qrSize,
      footerHeight,
      titleLines,
      titleLineHeight,
      titleHeight,
      descHeight,
      canvasHeight,
    };
  }

  function drawBackground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = themeColor;
    ctx.beginPath();
    ctx.arc(canvasWidth - 25 * SCALE, 25 * SCALE, 75 * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(10 * SCALE, canvasHeight - 10 * SCALE, 50 * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    coverImg: HTMLImageElement | null,
    coverHeight: number,
  ): void {
    if (coverImg) {
      const imgRatio = coverImg.width / coverImg.height;
      const targetRatio = WIDTH / coverHeight;
      let sx: number, sy: number, sWidth: number, sHeight: number;

      if (imgRatio > targetRatio) {
        sHeight = coverImg.height;
        sWidth = sHeight * targetRatio;
        sx = (coverImg.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = coverImg.width;
        sHeight = sWidth / targetRatio;
        sx = 0;
        sy = (coverImg.height - sHeight) / 2;
      }
      ctx.drawImage(
        coverImg,
        sx,
        sy,
        sWidth,
        sHeight,
        0,
        0,
        WIDTH,
        coverHeight,
      );
    } else {
      ctx.save();
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(0, 0, WIDTH, coverHeight);
      ctx.restore();
    }
  }

  function drawDateBadge(
    ctx: CanvasRenderingContext2D,
    coverHeight: number,
  ): void {
    const dateObj = parseDate(pubDate);
    if (!dateObj) return;

    const dateBoxW = 60 * SCALE;
    const dateBoxH = 60 * SCALE;
    const dateBoxX = PADDING;
    const dateBoxY = coverHeight - dateBoxH;

    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    drawRoundedRect(ctx, dateBoxX, dateBoxY, dateBoxW, dateBoxH, 4 * SCALE);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${30 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(dateObj.day, dateBoxX + dateBoxW / 2, dateBoxY + 24 * SCALE);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = SCALE;
    ctx.moveTo(dateBoxX + 10 * SCALE, dateBoxY + 42 * SCALE);
    ctx.lineTo(dateBoxX + dateBoxW - 10 * SCALE, dateBoxY + 42 * SCALE);
    ctx.stroke();

    ctx.font = `${10 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(
      `${dateObj.year} ${dateObj.month}`,
      dateBoxX + dateBoxW / 2,
      dateBoxY + 51 * SCALE,
    );
  }

  function drawTitleAndDesc(
    ctx: CanvasRenderingContext2D,
    layout: LayoutDimensions,
    startY: number,
  ): number {
    const { titleFontSize, descFontSize, titleLines, titleLineHeight } = layout;
    let drawY = startY;

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `700 ${titleFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = "#111827";
    for (const line of titleLines) {
      ctx.fillText(line, PADDING, drawY);
      drawY += titleLineHeight;
    }
    drawY += 16 * SCALE - (titleLineHeight - titleFontSize);

    if (description) {
      const descLines = getLines(ctx, description, CONTENT_WIDTH - 16 * SCALE);
      const descHeight = Math.min(descLines.length, 6) * (25 * SCALE);

      ctx.fillStyle = "#e5e7eb";
      drawRoundedRect(
        ctx,
        PADDING,
        drawY - 8 * SCALE,
        4 * SCALE,
        descHeight + 8 * SCALE,
        2 * SCALE,
      );
      ctx.fill();

      ctx.font = `${descFontSize}px ${FONT_FAMILY}`;
      ctx.fillStyle = "#4b5563";
      for (const line of descLines.slice(0, 6)) {
        ctx.fillText(line, PADDING + 16 * SCALE, drawY);
        drawY += 25 * SCALE;
      }
    } else {
      drawY += 8 * SCALE;
    }

    return drawY;
  }

  function drawDivider(ctx: CanvasRenderingContext2D, y: number): number {
    const drawY = y + 24 * SCALE;
    ctx.beginPath();
    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = SCALE;
    ctx.moveTo(PADDING, drawY);
    ctx.lineTo(WIDTH - PADDING, drawY);
    ctx.stroke();
    return drawY + 16 * SCALE;
  }

  function drawQrCode(
    ctx: CanvasRenderingContext2D,
    qrImg: HTMLImageElement | null,
    qrSize: number,
    footerY: number,
  ): void {
    const qrX = WIDTH - PADDING - qrSize;

    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
    ctx.shadowBlur = 4 * SCALE;
    ctx.shadowOffsetY = 2 * SCALE;
    drawRoundedRect(ctx, qrX, footerY, qrSize, qrSize, 4 * SCALE);
    ctx.fill();
    ctx.shadowColor = "transparent";

    if (qrImg) {
      const qrInnerSize = 76 * SCALE;
      const qrPadding = (qrSize - qrInnerSize) / 2;
      ctx.drawImage(
        qrImg,
        qrX + qrPadding,
        footerY + qrPadding,
        qrInnerSize,
        qrInnerSize,
      );
    }
  }

  function drawAvatar(
    ctx: CanvasRenderingContext2D,
    avatarImg: HTMLImageElement | null,
    footerY: number,
  ): void {
    if (!avatarImg) return;
    ctx.save();
    const avatarSize = 64 * SCALE;
    const avatarX = PADDING;
    ctx.beginPath();
    ctx.arc(
      avatarX + avatarSize / 2,
      footerY + avatarSize / 2,
      avatarSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, footerY, avatarSize, avatarSize);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(
      avatarX + avatarSize / 2,
      footerY + avatarSize / 2,
      avatarSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * SCALE;
    ctx.stroke();
  }

  function drawAuthorInfo(
    ctx: CanvasRenderingContext2D,
    footerY: number,
  ): void {
    const avatarOffset = avatar ? 64 * SCALE + 16 * SCALE : 0;
    const textX = PADDING + avatarOffset;

    ctx.fillStyle = "#9ca3af";
    ctx.font = `${12 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(i18n(I18nKey.author), textX, footerY + 4 * SCALE);

    ctx.fillStyle = "#1f2937";
    ctx.font = `700 ${20 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(author, textX, footerY + 20 * SCALE);

    ctx.fillStyle = "#9ca3af";
    ctx.font = `${12 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(i18n(I18nKey.contentScanToRead), textX, footerY + 44 * SCALE);

    ctx.fillStyle = "#1f2937";
    ctx.font = `700 ${20 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(siteTitle, textX, footerY + 60 * SCALE);
  }

  async function generatePoster() {
    showModal = true;
    if (posterImage) return;

    try {
      const qrCodeUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 100 * SCALE,
        color: { dark: "#000000", light: "#ffffff" },
      });

      const { qrImg, coverImg, avatarImg } = await loadPosterAssets(qrCodeUrl);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      const layout = computeLayout(ctx);
      canvas.width = WIDTH;
      canvas.height = layout.canvasHeight;

      drawBackground(ctx, canvas.width, canvas.height);
      drawCoverImage(ctx, coverImg, layout.coverHeight);
      drawDateBadge(ctx, layout.coverHeight);

      const afterTitle = drawTitleAndDesc(
        ctx,
        layout,
        layout.coverHeight + PADDING,
      );
      const footerY = drawDivider(ctx, afterTitle);

      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      drawQrCode(ctx, qrImg, layout.qrSize, footerY);
      drawAvatar(ctx, avatarImg, footerY);
      drawAuthorInfo(ctx, footerY);

      posterImage = canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Failed to generate poster:", error);
    }
  }

  function downloadPoster() {
    if (posterImage) {
      const a = document.createElement("a");
      a.href = posterImage;
      a.download = `poster-${title.replace(/\s+/g, "-")}.png`;
      a.click();
    }
  }

  function closeModal() {
    showModal = false;
  }

  function onBackdropKeydown(event: KeyboardEvent) {
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Spacebar" ||
      event.key === "Escape"
    ) {
      event.preventDefault();
      closeModal();
    }
  }

  let copied = false;
  const COPY_FEEDBACK_DURATION = 2000;

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      copied = true;
      setTimeout(() => {
        copied = false;
      }, COPY_FEEDBACK_DURATION);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }
</script>

<button
  class="btn-regular px-6 py-3 rounded-lg inline-flex items-center gap-2"
  on:click={generatePoster}
  aria-label="Generate Share Poster"
>
  <span>{i18n(I18nKey.contentShareArticle)}</span>
</button>

{#if showModal}
  <div
    use:portal
    class="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 p-4 transition-opacity"
    role="button"
    tabindex="0"
    aria-label="Close poster modal"
    on:click|self={closeModal}
    on:keydown={onBackdropKeydown}
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl transform transition-all"
    >
      <div
        class="p-6 flex justify-center bg-gray-50 dark:bg-gray-900 min-h-[200px] items-center"
      >
        {#if posterImage}
          <img
            src={posterImage}
            alt="Poster"
            class="max-w-full h-auto shadow-lg rounded-lg"
          />
        {:else}
          <div class="flex flex-col items-center gap-3">
            <div
              class="w-8 h-8 border-2 border-gray-200 rounded-full animate-spin"
              style="border-top-color: {themeColor}"
            ></div>
            <span class="text-sm text-gray-500 dark:text-gray-400"
              >{i18n(I18nKey.contentGeneratingPoster)}</span
            >
          </div>
        {/if}
      </div>

      <div
        class="p-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3"
      >
        <button
          class="py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          on:click={copyLink}
        >
          {#if copied}
            <Icon icon="material-symbols:check" width="20" height="20" />
            <span>{i18n(I18nKey.contentCopied)}</span>
          {:else}
            <Icon icon="material-symbols:link" width="20" height="20" />
            <span>{i18n(I18nKey.contentCopyLink)}</span>
          {/if}
        </button>
        <button
          class="py-3 text-white rounded-xl font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-90"
          style="background-color: {themeColor};"
          on:click={downloadPoster}
          disabled={!posterImage}
        >
          <Icon icon="material-symbols:download" width="20" height="20" />
          {i18n(I18nKey.contentSavePoster)}
        </button>
      </div>
    </div>
  </div>
{/if}
