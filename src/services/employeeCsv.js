const { insertEmployeeRow, assertEntityExists } = require('./employees');

const REQUIRED_HEADERS = ['name'];
const OPTIONAL_HEADERS = ['email', 'phone', 'employee_code', 'department', 'job_title'];
const KNOWN_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = line.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return bestCount > 1 ? best : ',';
}

function parseCsvLine(line, delimiter = ',') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalizeHeader(h) {
  return h.toLowerCase().replace(/^"|"$/g, '').trim();
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const rows = lines.slice(1).map((line, idx) => ({
    rowNumber: idx + 2,
    values: parseCsvLine(line, delimiter).map(v => v.replace(/^"|"$/g, '')),
  }));
  return { headers, rows };
}

function rowToObject(headers, values) {
  const obj = Object.fromEntries(KNOWN_HEADERS.map(h => [h, '']));
  headers.forEach((h, i) => {
    if (KNOWN_HEADERS.includes(h)) obj[h] = values[i] ?? '';
  });
  return obj;
}

function validateHeaders(headers) {
  if (!headers.length) {
    return 'CSV header row is empty or could not be parsed. Use comma, semicolon, or tab as the delimiter.';
  }
  if (!headers.includes('name')) {
    return `Missing required column: name. Supported columns: ${KNOWN_HEADERS.join(', ')}`;
  }
  return null;
}

function validateRow(row, seenEmails) {
  const errors = [];
  const name = (row.name || '').trim();
  const email = (row.email || '').trim().toLowerCase();
  const phone = (row.phone || '').trim();
  const employeeCode = (row.employee_code || '').trim();
  const department = (row.department || '').trim();
  const jobTitle = (row.job_title || '').trim();

  if (!name) errors.push('name is required');
  if (email && !EMAIL_RE.test(email)) errors.push('email format is invalid');
  if (email && seenEmails.has(email)) errors.push('duplicate email in CSV');

  return { name, email, phone, employeeCode, department, jobTitle, errors };
}

async function importEmployeesFromCsv({ csvText, entityType, entityId, createdBy }) {
  const { headers, rows } = parseCsv(csvText);
  const headerError = validateHeaders(headers);

  if (headerError) {
    return { created_count: 0, errors: [{ row: 1, message: headerError }], summary: headerError };
  }

  if (!rows.length) {
    return { created_count: 0, errors: [{ row: 1, message: 'CSV file has no data rows' }], summary: 'No employees to import' };
  }

  await assertEntityExists(entityType, entityId);

  const seenEmails = new Set();
  const rowErrors = [];
  const validRows = [];

  for (const { rowNumber, values } of rows) {
    const row = rowToObject(headers, values);
    const { name, email, phone, employeeCode, department, jobTitle, errors } = validateRow(row, seenEmails);

    if (errors.length) {
      rowErrors.push({ row: rowNumber, email: email || undefined, message: errors.join('; ') });
      continue;
    }

    if (email) seenEmails.add(email);
    validRows.push({ rowNumber, name, email, phone, employeeCode, department, jobTitle });
  }

  let createdCount = 0;

  for (const row of validRows) {
    try {
      await insertEmployeeRow({
        entityType,
        entityId,
        createdBy,
        row: {
          name: row.name,
          email: row.email || null,
          phone: row.phone || null,
          employeeCode: row.employeeCode || null,
          department: row.department || null,
          jobTitle: row.jobTitle || null,
        },
      });
      createdCount++;
    } catch (err) {
      rowErrors.push({
        row: row.rowNumber,
        email: row.email || undefined,
        message: err.code === '23505' ? 'Email already exists for this entity' : (err.message || 'Failed to create employee'),
      });
    }
  }

  const summary = rowErrors.length
    ? `Created ${createdCount} employee(s). ${rowErrors.length} row(s) failed.`
    : `Successfully created ${createdCount} employee(s).`;

  return { created_count: createdCount, errors: rowErrors, summary };
}

const CSV_TEMPLATE = [
  'name,email,phone,employee_code,department,job_title',
  'John Doe,john.doe@example.com,+15551234567,EMP001,Security,Guard',
  'Jane Smith,jane.smith@example.com,,EMP002,Front Desk,Receptionist',
].join('\n');

module.exports = {
  REQUIRED_HEADERS,
  OPTIONAL_HEADERS,
  KNOWN_HEADERS,
  CSV_TEMPLATE,
  parseCsv,
  validateHeaders,
  importEmployeesFromCsv,
};
