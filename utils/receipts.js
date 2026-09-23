const PDFDocument = require('pdfkit');

/**
 * Streams a PDF receipt directly to the HTTP response for a meal token
 * purchase. Called from a route like GET /student/meals/receipt/:tokenId.
 *
 * @param {object} res        Express response (PDF is piped to it)
 * @param {object} data       { token, menu, student }
 */
function streamMealReceipt(res, { token, menu, student }) {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="meal-receipt-${token.token_code}.pdf"`);
  doc.pipe(res);

  // Header
  doc.fontSize(18).fillColor('#a8124a').text('July-6 Hall (PUST)', { align: 'center' });
  doc.fontSize(11).fillColor('#555').text('Meal Token Payment Receipt', { align: 'center' });
  doc.moveDown(1);
  doc.strokeColor('#a8124a').lineWidth(1.2).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown(1);

  const row = (label, value) => {
    doc.fontSize(10).fillColor('#333').text(label, 40, doc.y, { continued: true, width: 180 });
    doc.fillColor('#000').text(value || '—', { align: 'left' });
    doc.moveDown(0.4);
  };

  row('Token Code:', token.token_code);
  row('Student Name:', student.name);
  row('Student ID:', student.student_id || '—');
  row('Meal Date:', new Date(menu.menu_date).toLocaleDateString());
  row('Meal Type:', menu.meal_type.charAt(0).toUpperCase() + menu.meal_type.slice(1));
  row('Menu Items:', menu.items);
  row('Quantity:', String(token.quantity));
  row('Unit Price:', `BDT ${Number(menu.price).toFixed(2)}`);
  row('Total Amount:', `BDT ${Number(token.total_amount).toFixed(2)}`);
  row('Purchased On:', new Date(token.purchase_date).toLocaleString());
  row('Status:', token.status.toUpperCase());

  doc.moveDown(1);
  doc.strokeColor('#ccc').lineWidth(0.6).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fontSize(8).fillColor('#888').text(
    'This is a system-generated receipt for hall dining services. Keep this for your records.',
    { align: 'center' }
  );

  doc.end();
}

/**
 * Streams a PDF receipt for a hall monthly-due / bKash payment.
 * @param {object} data { payment, student }
 */
function streamHallPaymentReceipt(res, { payment, student }) {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="hall-payment-receipt-${payment.id}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).fillColor('#a8124a').text('July-6 Hall (PUST)', { align: 'center' });
  doc.fontSize(11).fillColor('#555').text('Hall Fee Payment Receipt', { align: 'center' });
  doc.moveDown(1);
  doc.strokeColor('#a8124a').lineWidth(1.2).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown(1);

  const row = (label, value) => {
    doc.fontSize(10).fillColor('#333').text(label, 40, doc.y, { continued: true, width: 180 });
    doc.fillColor('#000').text(value || '—', { align: 'left' });
    doc.moveDown(0.4);
  };

  row('Receipt No.:', `HP-${payment.id}`);
  row('Student Name:', student.name);
  row('Student ID:', student.student_id || '—');
  row('Month / Year:', payment.month ? `${payment.month} ${payment.year}` : '—');
  row('Amount Paid:', `BDT ${Number(payment.amount).toFixed(2)}`);
  row('Payment Method:', (payment.payment_method || '—').toUpperCase());
  row('Transaction ID:', payment.transaction_id || '—');
  row('Status:', payment.status.toUpperCase());
  row('Paid On:', new Date(payment.payment_date).toLocaleString());

  doc.moveDown(1);
  doc.strokeColor('#ccc').lineWidth(0.6).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fontSize(8).fillColor('#888').text(
    'This is a system-generated receipt for hall accommodation fees. Keep this for your records.',
    { align: 'center' }
  );

  doc.end();
}

module.exports = { streamMealReceipt, streamHallPaymentReceipt };
