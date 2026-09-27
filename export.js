// Builds the downloadable reports (PDF, Excel, CSV) from the report object that
// index.html's buildReport() prepares. It is loaded on demand, after the PDF or
// Excel library, and uses index.html's helpers (money, formatDate, ...).
(function () {
  const NAVY = [15, 23, 42];
  const INDIGO = [79, 70, 229];
  const INK = [30, 41, 59];
  const MUTED = [100, 116, 139];
  const LINE = [226, 232, 240];
  const RED = [220, 38, 38];
  const GREEN = [21, 128, 61];

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // Characters the embedded Poppins subset can draw. Anything else (for example
  // names written in Telugu or Hindi) is drawn as an image of the browser's text.
  const PDF_SAFE = /^[\u0000-~ -ſ‐-‧‰-›₹™←-↓−]*$/;

  let fontCache = null;
  let logoCache = null;

  /* ---------- Shared helpers ---------- */

  async function fetchBase64(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function balanceColor(balance) {
    return balance > 0 ? RED : balance < 0 ? GREEN : MUTED;
  }

  function entryDetails(entry) {
    return [entry.paymentType, entry.notes].filter(Boolean).join(" · ");
  }

  function rupees(paise) {
    return Math.round(paise) / 100;
  }

  function excelDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /* ---------- PDF ---------- */

  async function registerFonts(doc) {
    if (!fontCache) {
      const [regular, bold] = await Promise.all([
        fetchBase64("vendor/fonts/poppins-regular.ttf"),
        fetchBase64("vendor/fonts/poppins-bold.ttf")
      ]);
      fontCache = { regular, bold };
    }

    doc.addFileToVFS("Poppins-Regular.ttf", fontCache.regular);
    doc.addFont("Poppins-Regular.ttf", "Poppins", "normal");
    doc.addFileToVFS("Poppins-Bold.ttf", fontCache.bold);
    doc.addFont("Poppins-Bold.ttf", "Poppins", "bold");
    doc.setFont("Poppins", "normal");
  }

  function textImage(text, sizePt, color, bold) {
    const scale = 6;
    const font = `${bold ? 700 : 400} ${sizePt * scale}px Poppins, "Noto Sans", system-ui, sans-serif`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 4;
    const height = Math.ceil(sizePt * scale * 1.5);

    canvas.width = width;
    canvas.height = height;
    ctx.font = font;
    ctx.fillStyle = `rgb(${color.join(",")})`;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 2, height / 2);

    const mmPerPx = 0.3528 / scale;
    return { dataUrl: canvas.toDataURL("image/png"), w: width * mmPerPx, h: height * mmPerPx };
  }

  // doc.text() that also copes with scripts the embedded font cannot draw.
  function drawText(doc, text, x, y, { size = 9, color = INK, bold = false, align = "left", maxWidth } = {}) {
    text = String(text ?? "");

    if (PDF_SAFE.test(text)) {
      doc.setFont("Poppins", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      if (maxWidth) text = doc.splitTextToSize(text, maxWidth)[0];
      doc.text(text, x, y, { align });
      return;
    }

    const img = textImage(text, size, color, bold);
    let { w, h } = img;
    if (maxWidth && w > maxWidth) {
      h *= maxWidth / w;
      w = maxWidth;
    }
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    doc.addImage(img.dataUrl, "PNG", left, y - h * 0.68, w, h);
  }

  function drawLogo(doc, x, y, size) {
    doc.setFillColor(...INDIGO);
    doc.roundedRect(x, y, size, size, size * 0.24, size * 0.24, "F");
    doc.setFont("Poppins", "bold");
    doc.setFontSize(size * 2.1);
    doc.setTextColor(255, 255, 255);
    doc.text("₹", x + size / 2, y + size / 2, { align: "center", baseline: "middle" });
  }

  function drawWatermark(doc) {
    doc.setFont("Poppins", "bold");
    doc.setTextColor(243, 244, 248);
    doc.setFontSize(300);
    doc.text("₹", PAGE_W / 2, 168, { align: "center", baseline: "middle" });
    doc.setFontSize(26);
    doc.setCharSpace(3);
    doc.text("DAILY KATHA", PAGE_W / 2, 232, { align: "center" });
    doc.setCharSpace(0);
  }

  function drawMainHeader(doc, report) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, 36, "F");
    doc.setFillColor(...INDIGO);
    doc.rect(0, 36, PAGE_W, 1.2, "F");

    drawLogo(doc, MARGIN, 9, 18);
    drawText(doc, "Daily Katha", MARGIN + 23, 17.5, { size: 18, color: [255, 255, 255], bold: true });
    drawText(doc, "Customer Ledger", MARGIN + 23, 23.5, { size: 8.5, color: [148, 163, 184] });

    drawText(doc, report.title, PAGE_W - MARGIN, 15.5, { size: 12, color: [255, 255, 255], bold: true, align: "right" });
    drawText(doc, report.rangeLabel, PAGE_W - MARGIN, 21.5, { size: 8.5, color: [203, 213, 225], align: "right" });
    drawText(doc, `Generated ${formatDateTime(report.generatedAt)}`, PAGE_W - MARGIN, 26.5,
      { size: 7, color: [148, 163, 184], align: "right" });
  }

  function drawRunningHeader(doc, report) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, 15, "F");
    doc.setFillColor(...INDIGO);
    doc.rect(0, 15, PAGE_W, 0.8, "F");

    drawLogo(doc, MARGIN, 3.5, 8);
    drawText(doc, "Daily Katha", MARGIN + 11, 9.3, { size: 10.5, color: [255, 255, 255], bold: true });
    drawText(doc, `${report.title} · ${report.periodLabel}`, PAGE_W - MARGIN, 9.1,
      { size: 8, color: [203, 213, 225], align: "right" });
  }

  function drawFooters(doc, report) {
    const pages = doc.getNumberOfPages();

    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);

      doc.setFont("Poppins", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...NAVY);
      doc.text("Daily Katha", MARGIN, PAGE_H - 9.5);

      const brandWidth = doc.getTextWidth("Daily Katha ");
      doc.setFont("Poppins", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text("· Computer-generated report. No signature required.", MARGIN + brandWidth, PAGE_H - 9.5);

      doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 9.5, { align: "right" });
    }
  }

  function drawSectionTitle(doc, title, y) {
    doc.setFillColor(...INDIGO);
    doc.roundedRect(MARGIN, y - 3.8, 1.3, 5, 0.6, 0.6, "F");
    drawText(doc, title, MARGIN + 3.5, y, { size: 11, color: NAVY, bold: true });
    return y + 4;
  }

  function drawTiles(doc, tiles, y) {
    const gap = 4;
    const width = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
    const height = 23;

    tiles.forEach((tile, i) => {
      const x = MARGIN + i * (width + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, width, height, 2.5, 2.5, "FD");

      doc.setFillColor(...tile.color);
      doc.roundedRect(x + 4, y + 4.2, 1.6, 1.6, 0.8, 0.8, "F");
      drawText(doc, tile.label, x + 7.3, y + 6.3, { size: 7.5, color: MUTED });

      // Shrink big numbers so they always fit inside the tile.
      let size = 12;
      doc.setFont("Poppins", "bold");
      while (size > 7 && doc.setFontSize(size).getTextWidth(tile.value) > width - 8) size -= 0.5;
      drawText(doc, tile.value, x + 4, y + 14.2, { size, color: tile.valueColor || NAVY, bold: true });

      if (tile.sub) drawText(doc, tile.sub, x + 4, y + 19.3, { size: 6.5, color: MUTED, maxWidth: width - 8 });
    });

    return y + height;
  }

  function tableOptions(doc, report, decorated) {
    return {
      theme: "plain",
      margin: { left: MARGIN, right: MARGIN, top: 22, bottom: 20 },
      styles: {
        font: "Poppins",
        fontSize: 8.3,
        textColor: INK,
        cellPadding: { top: 2.6, bottom: 2.6, left: 2.4, right: 2.4 },
        lineColor: LINE,
        lineWidth: { bottom: 0.25 },
        valign: "middle",
        overflow: "linebreak"
      },
      headStyles: {
        font: "Poppins",
        fontStyle: "bold",
        fontSize: 7.8,
        fillColor: NAVY,
        textColor: [255, 255, 255],
        lineWidth: 0
      },
      footStyles: {
        font: "Poppins",
        fontStyle: "bold",
        fillColor: [238, 242, 255],
        textColor: NAVY,
        lineWidth: 0
      },
      showFoot: "lastPage",
      willDrawPage: () => {
        const page = doc.getCurrentPageInfo().pageNumber;
        if (decorated.has(page)) return;
        decorated.add(page);
        drawWatermark(doc);
        drawRunningHeader(doc, report);
      },
      didParseCell: data => {
        const text = data.cell.text.join(" ");
        if (!PDF_SAFE.test(text)) {
          data.cell.fallbackText = text;
          data.cell.text = [""];
        }
      },
      didDrawCell: data => {
        const cell = data.cell;
        if (!cell.fallbackText) return;

        const style = cell.styles;
        const img = textImage(cell.fallbackText, style.fontSize, style.textColor, style.fontStyle === "bold");
        const maxWidth = cell.width - cell.padding("left") - cell.padding("right");
        const scale = Math.min(1, maxWidth / img.w);
        const w = img.w * scale;
        const h = img.h * scale;
        const x = style.halign === "right" ? cell.x + cell.width - cell.padding("right") - w : cell.x + cell.padding("left");
        doc.addImage(img.dataUrl, "PNG", x, cell.y + (cell.height - h) / 2, w, h);
      }
    };
  }

  function right(content, styles = {}) {
    return { content, styles: { halign: "right", ...styles } };
  }

  function balanceCell(balance, bold) {
    return {
      content: describeBalance(balance),
      styles: { halign: "right", textColor: balanceColor(balance), fontStyle: bold ? "bold" : "normal" }
    };
  }

  async function pdf(report) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const totals = report.totals;
    const decorated = new Set([1]);

    await registerFonts(doc);
    doc.setProperties({
      title: `${report.title} - ${report.periodLabel}`,
      subject: "Daily Katha report",
      author: "Daily Katha",
      creator: "Daily Katha"
    });

    drawWatermark(doc);
    drawMainHeader(doc, report);

    let y = 48;

    if (report.customer) {
      const c = report.customer;
      drawText(doc, "STATEMENT FOR", MARGIN, y, { size: 7, color: INDIGO, bold: true });
      drawText(doc, c.name, MARGIN, y + 6.5, { size: 15, color: NAVY, bold: true });
      const meta = [c.phone, c.address].filter(Boolean).join("  ·  ");
      if (meta) drawText(doc, meta, MARGIN, y + 12, { size: 8.5, color: MUTED, maxWidth: CONTENT_W });
      y += meta ? 18 : 13;
    }

    const tiles = report.customer
      ? [
          { label: "Opening balance", value: describeBalance(totals.opening), color: MUTED, valueColor: balanceColor(totals.opening) },
          { label: "Billed", value: money(totals.billed), color: RED },
          { label: "Received", value: money(totals.received), color: GREEN },
          { label: "Closing balance", value: describeBalance(totals.closing), color: INDIGO, valueColor: balanceColor(totals.closing) }
        ]
      : [
          { label: "To collect", value: money(totals.due), color: RED, valueColor: RED, sub: `from ${plural(totals.dueCount, "customer")}` },
          { label: "Advance held", value: money(totals.advance), color: GREEN, valueColor: GREEN, sub: `for ${plural(totals.advanceCount, "customer")}` },
          { label: "Billed", value: money(totals.billed), color: [234, 88, 12], sub: "in this period" },
          { label: "Received", value: money(totals.received), color: [42, 120, 214], sub: "in this period" }
        ];

    y = drawTiles(doc, tiles, y) + 11;

    if (!report.customer) {
      y = drawSectionTitle(doc, "Customer balances", y);

      if (report.balances.length) {
        doc.autoTable({
          ...tableOptions(doc, report, decorated),
          startY: y,
          head: [["Customer", "Phone", right("Opening"), right("Billed"), right("Received"), right("Closing")]],
          body: report.balances.map(r => [
            r.customer.name,
            r.customer.phone || "-",
            right(describeBalance(r.opening), { textColor: MUTED }),
            money(r.billed),
            money(r.received),
            balanceCell(r.closing, true)
          ]),
          foot: [[
            "Total", "",
            right(describeBalance(totals.opening)),
            right(money(totals.billed)),
            right(money(totals.received)),
            balanceCell(totals.closing, true)
          ]],
          columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 25, textColor: MUTED },
            2: { halign: "right" },
            3: { halign: "right" },
            4: { halign: "right" },
            5: { halign: "right", cellWidth: 34 }
          }
        });
        y = doc.lastAutoTable.finalY + 11;
      } else {
        drawText(doc, "No balances for this period.", MARGIN, y + 5, { size: 9, color: MUTED });
        y += 15;
      }
    }

    if (y > PAGE_H - 50) {
      doc.addPage();
      decorated.add(doc.getCurrentPageInfo().pageNumber);
      drawWatermark(doc);
      drawRunningHeader(doc, report);
      y = 26;
    }

    y = drawSectionTitle(doc, report.customer ? "Statement of entries" : "Entries", y);

    if (!report.entries.length) {
      drawText(doc, "No entries in this period.", MARGIN, y + 5, { size: 9, color: MUTED });
    } else if (report.customer) {
      doc.autoTable({
        ...tableOptions(doc, report, decorated),
        startY: y,
        head: [["Date", "Details", right("Billed"), right("Received"), right("Balance")]],
        body: [
          [
            { content: report.from ? formatDate(report.from) : "", styles: { textColor: MUTED } },
            { content: "Opening balance", styles: { textColor: MUTED } },
            "", "",
            balanceCell(totals.opening)
          ],
          ...report.entries.map(e => [
            formatDate(e.date),
            entryDetails(e) || "-",
            e.type === "bill" ? money(e.amountPaise) : "",
            e.type === "receive" ? money(e.amountPaise) : "",
            balanceCell(e.balanceAfter)
          ])
        ],
        foot: [["", "Closing balance", right(money(totals.billed)), right(money(totals.received)), balanceCell(totals.closing, true)]],
        columnStyles: {
          0: { cellWidth: 26 },
          2: { halign: "right", cellWidth: 26, textColor: RED },
          3: { halign: "right", cellWidth: 26, textColor: GREEN },
          4: { halign: "right", cellWidth: 36 }
        }
      });
    } else {
      doc.autoTable({
        ...tableOptions(doc, report, decorated),
        startY: y,
        head: [["Date", "Customer", "Details", right("Billed"), right("Received"), right("Balance after")]],
        body: report.entries.map(e => [
          formatDate(e.date),
          e.customerName,
          entryDetails(e) || "-",
          e.type === "bill" ? money(e.amountPaise) : "",
          e.type === "receive" ? money(e.amountPaise) : "",
          balanceCell(e.balanceAfter)
        ]),
        foot: [["", "Total", "", right(money(totals.billed)), right(money(totals.received)), ""]],
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 34 },
          3: { halign: "right", cellWidth: 25, textColor: RED },
          4: { halign: "right", cellWidth: 25, textColor: GREEN },
          5: { halign: "right", cellWidth: 32 }
        }
      });
    }

    drawFooters(doc, report);

    return { blob: doc.output("blob"), filename: `${report.fileBase}.pdf` };
  }

  /* ---------- Excel ---------- */

  const XL = {
    navy: "FF0F172A",
    indigo: "FF4F46E5",
    white: "FFFFFFFF",
    muted: "FF64748B",
    slate: "FFCBD5E1",
    zebra: "FFF8FAFC",
    soft: "FFEEF2FF",
    line: "FFE2E8F0",
    red: "FFDC2626",
    green: "FF15803D"
  };

  const MONEY_FORMAT = '"₹"#,##0.00';
  const BALANCE_FORMAT = '[Red]"₹"#,##0.00" due";[Color10]"₹"#,##0.00" adv";"Settled"';

  function fill(argb) {
    return { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  function brandHeader(ws, logoId, report, columnCount) {
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 16;
    ws.getRow(4).height = 4;

    for (let r = 1; r <= 4; r++) {
      for (let c = 1; c <= columnCount; c++) {
        ws.getCell(r, c).fill = fill(r === 4 ? XL.indigo : XL.navy);
      }
    }

    ws.addImage(logoId, { tl: { col: 0.15, row: 0.25 }, ext: { width: 52, height: 52 } });

    ws.getCell("B1").value = "Daily Katha";
    ws.getCell("B1").font = { size: 18, bold: true, color: { argb: XL.white } };
    ws.getCell("B1").alignment = { vertical: "bottom" };

    ws.getCell("B2").value = `${report.title} · ${report.rangeLabel}`;
    ws.getCell("B2").font = { size: 10, color: { argb: XL.slate } };

    ws.getCell("B3").value = `Generated ${formatDateTime(report.generatedAt)}`;
    ws.getCell("B3").font = { size: 8, color: { argb: "FF94A3B8" } };

    ws.headerFooter.oddFooter = `&L&8Daily Katha · ${report.title}&R&8Page &P of &N`;
  }

  function styleHeaderRow(row, rightAligned = []) {
    row.height = 22;
    row.eachCell((cell, col) => {
      cell.fill = fill(XL.navy);
      cell.font = { bold: true, color: { argb: XL.white }, size: 10 };
      cell.alignment = { vertical: "middle", horizontal: rightAligned.includes(col) ? "right" : "left" };
    });
  }

  function styleBodyRow(row, index) {
    row.height = 19;
    row.eachCell({ includeEmpty: true }, cell => {
      if (index % 2) cell.fill = fill(XL.zebra);
      cell.border = { bottom: { style: "thin", color: { argb: XL.line } } };
      cell.alignment = { ...(cell.alignment || {}), vertical: "middle" };
    });
  }

  function styleTotalRow(row) {
    row.height = 22;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill(XL.soft);
      cell.font = { ...(cell.font || {}), bold: true, color: { argb: XL.navy } };
      cell.border = { top: { style: "thin", color: { argb: XL.indigo } } };
      cell.alignment = { vertical: "middle" };
    });
  }

  function sectionTitle(ws, rowNumber, text) {
    const cell = ws.getCell(rowNumber, 2);
    cell.value = text;
    cell.font = { bold: true, size: 12, color: { argb: XL.navy } };
    ws.getRow(rowNumber).height = 22;
  }

  function setupPage(ws, landscape) {
    ws.pageSetup = {
      paperSize: 9,
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 }
    };
  }

  async function xlsx(report) {
    if (!logoCache) logoCache = await fetchBase64("icons/icon-192.png");

    const wb = new ExcelJS.Workbook();
    wb.creator = "Daily Katha";
    wb.company = "Daily Katha";
    wb.title = `${report.title} - ${report.periodLabel}`;
    wb.created = new Date(report.generatedAt);

    const logoId = wb.addImage({ base64: logoCache, extension: "png" });
    const totals = report.totals;

    /* Summary sheet */
    const summary = wb.addWorksheet("Summary", {
      views: [{ showGridLines: false }],
      properties: { tabColor: { argb: XL.indigo } }
    });
    setupPage(summary, false);
    summary.columns = [
      { width: 10 }, { width: 30 }, { width: 16 }, { width: 16 },
      { width: 16 }, { width: 16 }, { width: 20 }, { width: 12 }
    ];
    brandHeader(summary, logoId, report, 8);

    let row = 6;
    sectionTitle(summary, row++, "Summary");

    const summaryRows = report.customer
      ? [
          ["Customer", report.customer.name],
          ["Phone", report.customer.phone || "-"],
          ["Address", report.customer.address || "-"],
          ["Period", report.rangeLabel],
          ["Opening balance", rupees(totals.opening), BALANCE_FORMAT],
          ["Billed", rupees(totals.billed), MONEY_FORMAT],
          ["Received", rupees(totals.received), MONEY_FORMAT],
          ["Closing balance", rupees(totals.closing), BALANCE_FORMAT],
          ["Entries", totals.entries]
        ]
      : [
          ["Period", report.rangeLabel],
          ["To collect", rupees(totals.due), MONEY_FORMAT, XL.red],
          ["Advance held", rupees(totals.advance), MONEY_FORMAT, XL.green],
          ["Net balance", rupees(totals.closing), BALANCE_FORMAT],
          ["Billed in period", rupees(totals.billed), MONEY_FORMAT],
          ["Received in period", rupees(totals.received), MONEY_FORMAT],
          ["Entries", totals.entries],
          ["Customers", totals.customers]
        ];

    for (const [label, value, numFmt, color] of summaryRows) {
      const labelCell = summary.getCell(row, 2);
      const valueCell = summary.getCell(row, 3);
      summary.mergeCells(row, 3, row, 4);

      labelCell.value = label;
      labelCell.font = { color: { argb: XL.muted } };
      labelCell.fill = fill(XL.zebra);
      valueCell.value = value;
      valueCell.font = { bold: true, color: { argb: color || XL.navy } };
      valueCell.alignment = { horizontal: typeof value === "number" ? "right" : "left" };
      if (numFmt) valueCell.numFmt = numFmt;

      [labelCell, valueCell].forEach(cell => {
        cell.border = { bottom: { style: "thin", color: { argb: XL.line } } };
      });
      summary.getRow(row).height = 20;
      row++;
    }

    if (!report.customer) {
      row += 1;
      sectionTitle(summary, row++, "Customer balances");

      const head = summary.getRow(row++);
      head.values = ["", "Customer", "Phone", "Opening", "Billed", "Received", "Closing", "Status"];
      styleHeaderRow(head, [4, 5, 6, 7]);
      head.getCell(1).fill = undefined;

      report.balances.forEach((r, i) => {
        const line = summary.getRow(row++);
        line.values = [
          "", r.customer.name, r.customer.phone || "-",
          rupees(r.opening), rupees(r.billed), rupees(r.received), rupees(r.closing),
          r.closing > 0 ? "Due" : r.closing < 0 ? "Advance" : "Settled"
        ];
        styleBodyRow(line, i);
        line.getCell(1).fill = undefined;
        line.getCell(1).border = undefined;
        [4, 5, 6].forEach(c => { line.getCell(c).numFmt = MONEY_FORMAT; });
        line.getCell(7).numFmt = BALANCE_FORMAT;
        line.getCell(7).font = { bold: true };
        line.getCell(8).font = { color: { argb: r.closing > 0 ? XL.red : r.closing < 0 ? XL.green : XL.muted } };
      });

      const total = summary.getRow(row++);
      total.values = ["", "Total", "", rupees(totals.opening), rupees(totals.billed), rupees(totals.received), rupees(totals.closing), ""];
      styleTotalRow(total);
      total.getCell(1).fill = undefined;
      total.getCell(1).border = undefined;
      [4, 5, 6].forEach(c => { total.getCell(c).numFmt = MONEY_FORMAT; });
      total.getCell(7).numFmt = BALANCE_FORMAT;
    }

    /* Entries sheet */
    const entries = wb.addWorksheet("Entries", {
      views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
      properties: { tabColor: { argb: XL.navy } }
    });
    setupPage(entries, true);
    entries.columns = [
      { width: 14 }, { width: 26 }, { width: 15 }, { width: 11 }, { width: 15 },
      { width: 32 }, { width: 15 }, { width: 15 }, { width: 20 }
    ];
    brandHeader(entries, logoId, report, 9);

    const head = entries.getRow(6);
    head.values = ["Date", "Customer", "Phone", "Type", "Payment", "Notes", "Billed", "Received", "Balance after"];
    styleHeaderRow(head, [7, 8, 9]);

    report.entries.forEach((e, i) => {
      const line = entries.getRow(7 + i);
      line.values = [
        excelDate(e.date), e.customerName, e.customerPhone || "",
        e.type === "bill" ? "Bill" : "Received", e.paymentType, e.notes || "",
        e.type === "bill" ? rupees(e.amountPaise) : null,
        e.type === "receive" ? rupees(e.amountPaise) : null,
        rupees(e.balanceAfter)
      ];
      styleBodyRow(line, i);
      line.getCell(1).numFmt = "dd-mmm-yyyy";
      line.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
      line.getCell(4).font = { color: { argb: e.type === "bill" ? XL.red : XL.green } };
      line.getCell(7).numFmt = MONEY_FORMAT;
      line.getCell(8).numFmt = MONEY_FORMAT;
      line.getCell(9).numFmt = BALANCE_FORMAT;
    });

    if (report.entries.length) {
      const total = entries.getRow(7 + report.entries.length);
      total.values = ["Total", "", "", "", "", "", rupees(totals.billed), rupees(totals.received), ""];
      styleTotalRow(total);
      total.getCell(7).numFmt = MONEY_FORMAT;
      total.getCell(8).numFmt = MONEY_FORMAT;
      entries.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + report.entries.length, column: 9 } };
    } else {
      entries.getCell("A7").value = "No entries in this period.";
      entries.getCell("A7").font = { color: { argb: XL.muted } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    return {
      blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      filename: `${report.fileBase}.xlsx`
    };
  }

  /* ---------- CSV ---------- */

  function csvCell(value, isText) {
    let text = String(value ?? "");
    // Stop spreadsheet apps from running text such as "=SUM(...)" as a formula.
    if (isText && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function csv(report) {
    const t = report.totals;
    const amount = paise => (paise / 100).toFixed(2);
    const lines = [
      ["Daily Katha", report.title],
      ["Period", report.rangeLabel],
      ...(report.customer ? [["Customer", report.customer.name], ["Phone", report.customer.phone]] : []),
      ["Generated", formatDateTime(report.generatedAt)],
      [],
      ...(report.customer
        ? [["Opening balance", amount(t.opening)], ["Closing balance", amount(t.closing)]]
        : [["To collect", amount(t.due)], ["Advance held", amount(t.advance)]]),
      ["Billed", amount(t.billed)],
      ["Received", amount(t.received)],
      [],
      ["Date", "Customer", "Phone", "Type", "Payment", "Notes", "Billed", "Received", "Balance after"],
      ...report.entries.map(e => [
        e.date, e.customerName, e.customerPhone, e.type === "bill" ? "Bill" : "Received",
        e.paymentType, e.notes,
        e.type === "bill" ? amount(e.amountPaise) : "",
        e.type === "receive" ? amount(e.amountPaise) : "",
        amount(e.balanceAfter)
      ])
    ];

    const textColumns = new Set([1, 2, 5]);
    const body = lines
      .map(line => line.map((value, i) => csvCell(value, textColumns.has(i))).join(","))
      .join("\r\n");

    // The BOM makes Excel read names in any language correctly.
    return {
      blob: new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }),
      filename: `${report.fileBase}.csv`
    };
  }

  window.DailyKathaExport = { pdf, xlsx, csv };
})();
