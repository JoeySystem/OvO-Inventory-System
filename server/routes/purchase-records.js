const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const { ValidationError, NotFoundError, asyncHandler } = require('../utils/errors');
const { logOperation } = require('../utils/logger');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }
});
const previewStore = new Map();

router.use(requireAuth);

function trimText(value) {
    if (value === undefined || value === null) return null;
    const result = String(value).trim();
    return result || null;
}

function normalizeUploadedFilename(value) {
    const text = trimText(value);
    if (!text) return null;
    try {
        const decoded = Buffer.from(text, 'latin1').toString('utf8').trim();
        if (!decoded) return text;
        if (/[\u3400-\u9fff]/.test(decoded)) return decoded;
        return text;
    } catch {
        return text;
    }
}

function normalizeRecord(record) {
    if (!record) return record;
    return {
        ...record,
        source_file: normalizeUploadedFilename(record.source_file)
    };
}

function parseNumber(value, fieldName) {
    if (value === undefined || value === null || value === '') return 0;
    const normalized = String(value).replace(/,/g, '').trim();
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
        throw new ValidationError(`${fieldName} 必须是数字`);
    }
    return parsed;
}

function detectWorksheetHeaderRow(sheet, requiredHeaders) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber++) {
        const values = sheet.getRow(rowNumber).values
            .slice(1)
            .map(value => String(value || '').trim());
        if (requiredHeaders.every(header => values.includes(header))) {
            return rowNumber;
        }
    }
    return null;
}

function buildPreviewToken(prefix = 'purchase_records') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getCellValue(row, colNumber) {
    if (!row || !colNumber || Number.isNaN(Number(colNumber))) return '';
    let value = row.getCell(colNumber).value;
    if (value && typeof value === 'object' && value.result !== undefined) value = value.result;
    if (value && typeof value === 'object' && value.text) value = value.text;
    return value ?? '';
}

function buildHeaderIndex(headerRowValues) {
    const index = new Map();
    headerRowValues.forEach((header, arrayIndex) => {
        const key = trimText(header);
        if (key) index.set(key, arrayIndex + 1);
    });
    return index;
}

function cleanupPreviewStore() {
    const now = Date.now();
    for (const [token, entry] of previewStore.entries()) {
        if (!entry || entry.expiresAt <= now) {
            previewStore.delete(token);
        }
    }
}

async function parsePurchaseWorkbook(file) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ValidationError('Excel 中没有可用工作表');

    const summaryHeaderRow = detectWorksheetHeaderRow(sheet, ['录单时间', '单据编号', '供货单位', '入库仓库', '数量', '采购金额', '已付款金额', '待付款金额']);
    const detailHeaderRow = detectWorksheetHeaderRow(sheet, ['录单时间', '单据编号', '单位名称', '仓库', '商品编号', '商品名称', '数量', '单价', '金额']);
    const mode = detailHeaderRow ? 'detail' : (summaryHeaderRow ? 'summary' : null);
    const headerRowNumber = detailHeaderRow || summaryHeaderRow;
    if (!mode || !headerRowNumber) {
        throw new ValidationError('无法识别采购单据查询表头，请确认文件格式正确');
    }

    const headers = [];
    sheet.getRow(headerRowNumber).eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '').trim();
    });
    const headerIndex = buildHeaderIndex(headers.slice(1));

    if (mode === 'summary') {
        const rows = [];
        for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
            const row = sheet.getRow(rowNumber);
            const record = {};
            let hasValue = false;
            headers.forEach((header, colNumber) => {
                if (!header) return;
                const value = getCellValue(row, colNumber);
                record[header] = value;
                if (value !== null && value !== undefined && String(value).trim() !== '') hasValue = true;
            });
            if (!hasValue) continue;

            rows.push({
                rowNumber,
                orderDate: trimText(record['录单时间']),
                orderNo: trimText(record['单据编号']),
                supplierName: trimText(record['供货单位']),
                warehouseName: trimText(record['入库仓库']),
                quantity: parseNumber(record['数量'], '数量'),
                amount: parseNumber(record['采购金额'], '采购金额'),
                paidAmount: parseNumber(record['已付款金额'], '已付款金额'),
                unpaidAmount: parseNumber(record['待付款金额'], '待付款金额'),
                items: [],
                raw: record
            });
        }
        return { mode, rows: rows.filter(item => item.orderNo || item.supplierName) };
    }

    const grouped = new Map();
    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber);
        const values = headers.slice(1).map((_, idx) => getCellValue(row, idx + 1));
        if (!values.some(value => value !== null && value !== undefined && String(value).trim() !== '')) continue;

        const read = header => getCellValue(row, headerIndex.get(header));
        const orderNo = trimText(read('单据编号'));
        const orderDate = trimText(read('录单时间'));
        const supplierName = trimText(read('单位名称'));
        const warehouseName = trimText(read('仓库'));
        if (!orderNo && !supplierName) continue;

        const record = {};
        headers.forEach((header, colNumber) => {
            if (!header) return;
            record[header] = getCellValue(row, colNumber);
        });

        if (!grouped.has(orderNo || `row_${rowNumber}`)) {
            grouped.set(orderNo || `row_${rowNumber}`, {
                rowNumber,
                orderDate,
                orderNo,
                supplierName,
                warehouseName,
                quantity: 0,
                amount: 0,
                paidAmount: null,
                unpaidAmount: null,
                items: [],
                raw: {
                    orderNo,
                    orderDate,
                    supplierName,
                    warehouseName,
                    sourceType: 'detail'
                }
            });
        }

        const group = grouped.get(orderNo || `row_${rowNumber}`);
        const quantity = parseNumber(read('数量'), '数量');
        const amount = parseNumber(read('金额'), '金额');
        const lineItem = {
            rowNumber,
            lineNo: group.items.length + 1,
            itemCode: trimText(read('商品编号')),
            itemName: trimText(read('商品名称')),
            spec: trimText(read('规格')),
            model: trimText(read('型号')),
            brand: trimText(read('品牌')),
            unit: trimText(read('单位')),
            quantity,
            unitPrice: parseNumber(read('单价'), '单价'),
            amount,
            note: trimText(read('明细备注')),
            raw: record
        };
        group.items.push(lineItem);
        group.quantity += quantity;
        group.amount += amount;
    }

    return { mode, rows: [...grouped.values()].filter(item => item.orderNo || item.supplierName) };
}

router.post('/import/preview', requirePermission('receive', 'add'), upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError('请选择采购单据查询文件');

    cleanupPreviewStore();
    const db = getDB();
    const parsed = await parsePurchaseWorkbook(req.file);
    const rows = parsed.rows;
    if (!rows.length) throw new ValidationError('采购单据查询文件中没有可导入的数据');

    const existingByNo = new Map(
        db.prepare('SELECT id, order_no, paid_amount, unpaid_amount FROM purchase_records').all().map(item => [item.order_no, item])
    );

    const items = rows.map(row => {
        const existing = row.orderNo ? existingByNo.get(row.orderNo) : null;
        const errors = [];
        if (!row.orderDate) errors.push('录单时间不能为空');
        if (!row.orderNo) errors.push('单据编号不能为空');
        if (!row.supplierName) errors.push('供货单位不能为空');
        return {
            row: row.rowNumber,
            action: errors.length ? 'invalid' : (existing ? 'update' : 'create'),
            recordId: existing?.id || null,
            currentPaidAmount: existing?.paid_amount ?? null,
            currentUnpaidAmount: existing?.unpaid_amount ?? null,
            orderDate: row.orderDate,
            orderNo: row.orderNo,
            supplierName: row.supplierName,
            warehouseName: row.warehouseName,
            quantity: row.quantity,
            amount: row.amount,
            paidAmount: row.paidAmount,
            unpaidAmount: row.unpaidAmount,
            itemCount: row.items?.length || 0,
            errors,
            raw: row
        };
    });

    const summary = {
        total: items.length,
        creatable: items.filter(item => item.action === 'create').length,
        updatable: items.filter(item => item.action === 'update').length,
        invalid: items.filter(item => item.action === 'invalid').length
    };

    const previewToken = buildPreviewToken();
    previewStore.set(previewToken, {
        createdBy: req.session.user.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000,
        sourceFile: normalizeUploadedFilename(req.file.originalname) || 'purchase-records.xlsx',
        mode: parsed.mode,
        items,
        summary
    });

    res.json({
        success: true,
        data: {
            previewToken,
            summary,
            mode: parsed.mode,
            items,
            note: '本次导入仅生成历史采购记录，不参与当前库存计算和正式单据状态流转。'
        }
    });
}));

router.post('/import/commit', requirePermission('receive', 'add'), (req, res) => {
    cleanupPreviewStore();
    const { previewToken } = req.body || {};
    if (!previewToken) throw new ValidationError('缺少 previewToken');

    const preview = previewStore.get(previewToken);
    if (!preview || preview.createdBy !== req.session.user.id) {
        throw new ValidationError('采购单据导入预览已失效，请重新上传文件');
    }

    if (preview.summary.invalid > 0) {
        throw new ValidationError(`存在 ${preview.summary.invalid} 条无效数据，无法提交`);
    }

    const db = getDB();
    const run = db.transaction(() => {
        const insertStmt = db.prepare(`
            INSERT INTO purchase_records (
                order_date, order_no, supplier_name, warehouse_name,
                quantity, amount, paid_amount, unpaid_amount,
                source_file, raw_source, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateStmt = db.prepare(`
            UPDATE purchase_records
            SET order_date = ?, supplier_name = ?, warehouse_name = ?,
                quantity = ?, amount = ?, paid_amount = ?, unpaid_amount = ?,
                source_file = ?, raw_source = ?, updated_at = datetime('now','localtime')
            WHERE id = ?
        `);
        const deleteItemStmt = db.prepare(`DELETE FROM purchase_record_items WHERE record_id = ?`);
        const insertItemStmt = db.prepare(`
            INSERT INTO purchase_record_items (
                record_id, line_no, item_code, item_name, spec, model, brand, unit,
                quantity, unit_price, amount, note, raw_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        let updated = 0;
        let importedItems = 0;
        preview.items.forEach(item => {
            const row = item.raw;
            const rawSource = JSON.stringify(row.raw || row);
            let recordId = item.recordId || null;
            const hasDetailItems = Array.isArray(row.items) && row.items.length > 0;
            if (item.action === 'update') {
                updateStmt.run(
                    row.orderDate,
                    row.supplierName,
                    row.warehouseName,
                    row.quantity,
                    row.amount,
                    row.paidAmount === null || row.paidAmount === undefined ? item.currentPaidAmount || 0 : row.paidAmount,
                    row.unpaidAmount === null || row.unpaidAmount === undefined ? item.currentUnpaidAmount || 0 : row.unpaidAmount,
                    preview.sourceFile,
                    rawSource,
                    item.recordId
                );
                recordId = item.recordId;
                if (hasDetailItems) {
                    deleteItemStmt.run(recordId);
                }
                updated++;
            } else {
                const info = insertStmt.run(
                    row.orderDate,
                    row.orderNo,
                    row.supplierName,
                row.warehouseName,
                row.quantity,
                row.amount,
                row.paidAmount || 0,
                row.unpaidAmount || 0,
                preview.sourceFile,
                rawSource,
                req.session.user.id
                );
                recordId = Number(info.lastInsertRowid);
                imported++;
            }

            (row.items || []).forEach(detailItem => {
                insertItemStmt.run(
                    recordId,
                    detailItem.lineNo,
                    detailItem.itemCode,
                    detailItem.itemName,
                    detailItem.spec,
                    detailItem.model,
                    detailItem.brand,
                    detailItem.unit,
                    detailItem.quantity,
                    detailItem.unitPrice,
                    detailItem.amount,
                    detailItem.note,
                    JSON.stringify(detailItem.raw || detailItem)
                );
                importedItems++;
            });
        });

        return { imported, updated, importedItems, total: preview.items.length };
    });

    const result = run();
    previewStore.delete(previewToken);

    logOperation({
        userId: req.session.user.id,
        action: 'import',
        resource: 'purchase_records',
        detail: `导入历史采购记录：新增 ${result.imported}，更新 ${result.updated}，明细 ${result.importedItems} 条，共 ${result.total} 条`,
        ip: req.ip
    });

    res.json({
        success: true,
        data: {
            ...result,
            note: '历史采购记录已导入，仅用于查询，不参与当前库存计算。'
        }
    });
});

router.get('/', requirePermission('receive', 'view'), (req, res) => {
    const db = getDB();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    if (trimText(req.query.start)) {
        conditions.push('datetime(pr.order_date) >= datetime(?)');
        params.push(String(req.query.start).trim());
    }
    if (trimText(req.query.end)) {
        conditions.push("datetime(pr.order_date) <= datetime(? || ' 23:59:59')");
        params.push(String(req.query.end).trim());
    }
    if (trimText(req.query.supplier)) {
        conditions.push('pr.supplier_name LIKE ?');
        params.push(`%${String(req.query.supplier).trim()}%`);
    }
    if (trimText(req.query.orderNo)) {
        conditions.push('pr.order_no LIKE ?');
        params.push(`%${String(req.query.orderNo).trim()}%`);
    }
    if (trimText(req.query.warehouse)) {
        conditions.push('pr.warehouse_name LIKE ?');
        params.push(`%${String(req.query.warehouse).trim()}%`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const items = db.prepare(`
        SELECT pr.*,
               COUNT(pri.id) AS item_count,
               u.display_name AS created_by_name
        FROM purchase_records pr
        LEFT JOIN purchase_record_items pri ON pri.record_id = pr.id
        LEFT JOIN users u ON u.id = pr.created_by
        ${whereClause}
        GROUP BY pr.id
        ORDER BY datetime(pr.order_date) DESC, pr.id DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(normalizeRecord);

    const total = db.prepare(`SELECT COUNT(*) as total FROM purchase_records pr ${whereClause}`).get(...params)?.total || 0;
    const summary = db.prepare(`
        SELECT
            COUNT(*) as totalRecords,
            COUNT(DISTINCT supplier_name) as supplierCount,
            COALESCE(SUM(quantity), 0) as totalQuantity,
            COALESCE(SUM(amount), 0) as totalAmount,
            COALESCE(SUM(paid_amount), 0) as totalPaidAmount,
            COALESCE(SUM(unpaid_amount), 0) as totalUnpaidAmount
        FROM purchase_records pr
        ${whereClause}
    `).get(...params) || {};

    res.json({
        success: true,
        data: {
            items,
            summary,
            pagination: {
                page,
                limit,
                total: Number(total),
                totalPages: Math.ceil(Number(total) / limit)
            }
        }
    });
});

router.get('/:id', requirePermission('receive', 'view'), (req, res) => {
    const db = getDB();
    const record = db.prepare(`
        SELECT pr.*,
               COUNT(pri.id) AS item_count,
               u.display_name AS created_by_name
        FROM purchase_records pr
        LEFT JOIN purchase_record_items pri ON pri.record_id = pr.id
        LEFT JOIN users u ON u.id = pr.created_by
        WHERE pr.id = ?
        GROUP BY pr.id
    `).get(req.params.id);
    if (!record) throw new NotFoundError('历史采购记录');

    const detailItems = db.prepare(`
        SELECT *
        FROM purchase_record_items
        WHERE record_id = ?
        ORDER BY line_no ASC, id ASC
    `).all(req.params.id);

    res.json({
        success: true,
        data: {
            record: normalizeRecord(record),
            items: detailItems,
            note: '该记录来自历史采购单据导入，仅供查询，不参与当前库存计算和正式单据状态流转。'
        }
    });
});

module.exports = router;
