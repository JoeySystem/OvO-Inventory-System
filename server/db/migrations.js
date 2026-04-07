const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);
}

function hasTable(db, tableName) {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(tableName);
    return !!row;
}

function hasColumn(db, tableName, columnName) {
    if (!hasTable(db, tableName)) return false;
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some(column => column.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, definition) {
    if (!hasColumn(db, tableName, columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

function applySqlFile(db, fileName) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf-8');
    db.exec(sql);
}

function applyMigration(db, name, applyFn) {
    const exists = db.prepare(
        'SELECT 1 FROM schema_migrations WHERE name = ?'
    ).get(name);
    if (exists) return false;

    const run = db.transaction(() => {
        applyFn();
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    });
    run();
    return true;
}

function runLegacyMigrations(db) {
    try {
        if (hasTable(db, 'stock_movements') && !hasColumn(db, 'stock_movements', 'source')) {
            db.exec("ALTER TABLE stock_movements ADD COLUMN source TEXT");
            db.exec("CREATE INDEX IF NOT EXISTS idx_movements_source ON stock_movements(source)");
            console.log('📦 迁移完成: stock_movements 增加 source 字段');
        }

        const trigger = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_negative_inventory'"
        ).get();
        if (trigger) {
            db.exec('DROP TRIGGER prevent_negative_inventory');
            console.log('📦 迁移完成: 移除非负库存触发器（允许负库存）');
        }
    } catch (err) {
        // 首次初始化或表尚未创建时忽略
    }
}

function runMaterialMasterMigration(db) {
    if (!hasTable(db, 'materials')) return;

    applyMigration(db, '001_material_master_foundation', () => {
        addColumnIfMissing(db, 'materials', 'material_type', "TEXT DEFAULT 'raw'");
        addColumnIfMissing(db, 'materials', 'internal_code', 'TEXT');
        addColumnIfMissing(db, 'materials', 'model', 'TEXT');
        addColumnIfMissing(db, 'materials', 'spec_key', 'TEXT');

        addColumnIfMissing(db, 'materials', 'is_purchasable', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_producible', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_sellable', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'default_warehouse_id', 'INTEGER REFERENCES warehouses(id)');
        addColumnIfMissing(db, 'materials', 'default_supplier_id', 'INTEGER');
        addColumnIfMissing(db, 'materials', 'lead_time_days', 'INTEGER DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'min_purchase_qty', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'purchase_lot_size', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'tax_rate', 'REAL DEFAULT 0');

        addColumnIfMissing(db, 'materials', 'safety_stock', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'reorder_point', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'economic_order_qty', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'allow_negative_stock', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_batch_tracked', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_serial_tracked', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_expiry_tracked', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'stock_count_cycle_days', 'INTEGER');

        addColumnIfMissing(db, 'materials', 'standard_cost', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'last_purchase_price', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'avg_cost', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'cost_source', "TEXT DEFAULT 'manual'");
        addColumnIfMissing(db, 'materials', 'cost_updated_at', 'TEXT');

        addColumnIfMissing(db, 'materials', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'draft'");
        addColumnIfMissing(db, 'materials', 'activated_at', 'TEXT');
        addColumnIfMissing(db, 'materials', 'obsolete_at', 'TEXT');

        addColumnIfMissing(db, 'materials', 'default_bom_id', 'INTEGER REFERENCES boms(id)');
        addColumnIfMissing(db, 'materials', 'default_sop_id', 'INTEGER REFERENCES sops(id)');
        addColumnIfMissing(db, 'materials', 'yield_rate', 'REAL DEFAULT 1');
        addColumnIfMissing(db, 'materials', 'scrap_rate', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'is_key_part', 'INTEGER NOT NULL DEFAULT 0');

        addColumnIfMissing(db, 'materials', 'master_data_owner', 'INTEGER REFERENCES users(id)');
        addColumnIfMissing(db, 'materials', 'data_quality_status', "TEXT DEFAULT 'normal'");
        addColumnIfMissing(db, 'materials', 'version_no', 'INTEGER NOT NULL DEFAULT 1');

        applySqlFile(db, '001_material_master_foundation.sql');
    });
}

function runWarehouseActionDocumentMigration(db) {
    if (!hasTable(db, 'stock_movements')) return;

    applyMigration(db, '002_stock_movement_document_fields', () => {
        addColumnIfMissing(db, 'stock_movements', 'biz_type', 'TEXT');
        addColumnIfMissing(db, 'stock_movements', 'doc_status', "TEXT DEFAULT 'posted'");
        addColumnIfMissing(db, 'stock_movements', 'source_doc_type', 'TEXT');
        addColumnIfMissing(db, 'stock_movements', 'source_doc_id', 'INTEGER');
        addColumnIfMissing(db, 'stock_movements', 'source_doc_no', 'TEXT');
        addColumnIfMissing(db, 'stock_movements', 'executed_at', 'TEXT');

        db.exec(`
            UPDATE stock_movements
            SET doc_status = COALESCE(doc_status, 'posted'),
                executed_at = COALESCE(executed_at, created_at),
                source_doc_no = COALESCE(source_doc_no, reference_no),
                source_doc_type = CASE
                    WHEN source_doc_type IS NOT NULL AND source_doc_type != '' THEN source_doc_type
                    WHEN source = 'manual_in' THEN 'receive_execution'
                    WHEN source = 'manual_out' THEN 'issue_execution'
                    WHEN source = 'transfer' THEN 'transfer_execution'
                    WHEN source = 'manual_adjust' THEN 'count_execution'
                    ELSE 'legacy_movement'
                END,
                biz_type = CASE
                    WHEN biz_type IS NOT NULL AND biz_type != '' THEN biz_type
                    WHEN source = 'manual_in' THEN 'manual_receive'
                    WHEN source = 'manual_out' THEN 'manual_issue'
                    WHEN source = 'transfer' THEN 'warehouse_transfer'
                    WHEN source = 'manual_adjust' THEN 'manual_count_adjust'
                    ELSE COALESCE(source, type)
                END
        `);
    });
}

function runStockExecutionDocumentStorageMigration(db) {
    applyMigration(db, '003_stock_execution_documents', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS stock_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_no TEXT NOT NULL UNIQUE,
                doc_type TEXT NOT NULL,
                biz_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'posted',
                source TEXT,
                warehouse_id INTEGER REFERENCES warehouses(id),
                to_warehouse_id INTEGER REFERENCES warehouses(id),
                counterparty TEXT,
                reference_no TEXT,
                notes TEXT,
                executed_at TEXT,
                posted_at TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS stock_document_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
                line_no INTEGER NOT NULL DEFAULT 1,
                material_id INTEGER NOT NULL REFERENCES materials(id),
                quantity REAL NOT NULL DEFAULT 0,
                unit TEXT,
                unit_price REAL,
                total_price REAL,
                before_quantity REAL,
                actual_quantity REAL,
                delta_quantity REAL,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_stock_documents_doc_no ON stock_documents(doc_no);
            CREATE INDEX IF NOT EXISTS idx_stock_documents_type ON stock_documents(doc_type);
            CREATE INDEX IF NOT EXISTS idx_stock_documents_exec ON stock_documents(executed_at);
            CREATE INDEX IF NOT EXISTS idx_stock_document_items_doc ON stock_document_items(document_id);
            CREATE INDEX IF NOT EXISTS idx_stock_document_items_material ON stock_document_items(material_id);
        `);

        if (hasColumn(db, 'stock_movements', 'source_doc_id')) {
            db.exec(`
                INSERT INTO stock_documents (
                    doc_no, doc_type, biz_type, status, source, warehouse_id, to_warehouse_id,
                    counterparty, reference_no, notes, executed_at, posted_at, created_by
                )
                SELECT
                    doc_no,
                    MAX(source_doc_type) as doc_type,
                    MAX(biz_type) as biz_type,
                    COALESCE(MAX(doc_status), 'posted') as status,
                    MAX(source) as source,
                    MAX(warehouse_id) as warehouse_id,
                    MAX(to_warehouse_id) as to_warehouse_id,
                    MAX(counterparty) as counterparty,
                    MAX(reference_no) as reference_no,
                    MAX(notes) as notes,
                    MAX(COALESCE(executed_at, created_at)) as executed_at,
                    MAX(COALESCE(executed_at, created_at)) as posted_at,
                    MAX(created_by) as created_by
                FROM (
                    SELECT
                        id,
                        COALESCE(NULLIF(source_doc_no, ''), NULLIF(reference_no, ''), 'MOV-' || id) as doc_no,
                        source_doc_type,
                        biz_type,
                        doc_status,
                        source,
                        warehouse_id,
                        to_warehouse_id,
                        counterparty,
                        reference_no,
                        notes,
                        executed_at,
                        created_at,
                        created_by
                    FROM stock_movements
                ) grouped
                GROUP BY doc_no
            `);

            db.exec(`
                INSERT INTO stock_document_items (
                    document_id, line_no, material_id, quantity, unit, unit_price, total_price,
                    before_quantity, actual_quantity, delta_quantity, notes
                )
                SELECT
                    sd.id,
                    ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(NULLIF(sm.source_doc_no, ''), NULLIF(sm.reference_no, ''), 'MOV-' || sm.id)
                        ORDER BY sm.id
                    ) as line_no,
                    sm.material_id,
                    sm.quantity,
                    m.unit,
                    sm.unit_price,
                    sm.total_price,
                    NULL,
                    NULL,
                    CASE WHEN sm.type = 'adjust' THEN sm.quantity ELSE NULL END,
                    sm.notes
                FROM stock_movements sm
                JOIN stock_documents sd
                  ON sd.doc_no = COALESCE(NULLIF(sm.source_doc_no, ''), NULLIF(sm.reference_no, ''), 'MOV-' || sm.id)
                LEFT JOIN materials m ON sm.material_id = m.id
            `);

            db.exec(`
                UPDATE stock_movements
                SET source_doc_id = (
                    SELECT sd.id FROM stock_documents sd
                    WHERE sd.doc_no = COALESCE(NULLIF(stock_movements.source_doc_no, ''), NULLIF(stock_movements.reference_no, ''), 'MOV-' || stock_movements.id)
                )
                WHERE source_doc_id IS NULL
            `);
        }
    });
}

function runExecutionTimestampLocalizationMigration(db) {
    applyMigration(db, '020_execution_timestamps_to_localtime', () => {
        if (hasTable(db, 'stock_documents')) {
            db.exec(`
                UPDATE stock_documents
                SET executed_at = datetime(executed_at, 'localtime')
                WHERE executed_at IS NOT NULL
                  AND created_at IS NOT NULL
                  AND datetime(executed_at, '+6 hours') <= datetime(created_at)
            `);

            db.exec(`
                UPDATE stock_documents
                SET posted_at = datetime(posted_at, 'localtime')
                WHERE posted_at IS NOT NULL
                  AND created_at IS NOT NULL
                  AND datetime(posted_at, '+6 hours') <= datetime(created_at)
            `);
        }

        if (hasTable(db, 'stock_movements')) {
            db.exec(`
                UPDATE stock_movements
                SET executed_at = datetime(executed_at, 'localtime')
                WHERE executed_at IS NOT NULL
                  AND created_at IS NOT NULL
                  AND datetime(executed_at, '+6 hours') <= datetime(created_at)
            `);
        }
    });
}

function runStockDocumentWorkflowMigration(db) {
    if (!hasTable(db, 'stock_documents')) return;

    applyMigration(db, '004_stock_document_workflow_fields', () => {
        addColumnIfMissing(db, 'stock_documents', 'submitted_at', 'TEXT');
        addColumnIfMissing(db, 'stock_documents', 'submitted_by', 'INTEGER REFERENCES users(id)');
        addColumnIfMissing(db, 'stock_documents', 'executed_by', 'INTEGER REFERENCES users(id)');
        addColumnIfMissing(db, 'stock_documents', 'posted_by', 'INTEGER REFERENCES users(id)');
        addColumnIfMissing(db, 'stock_documents', 'voided_at', 'TEXT');
        addColumnIfMissing(db, 'stock_documents', 'voided_by', 'INTEGER REFERENCES users(id)');
        addColumnIfMissing(db, 'stock_documents', 'status_reason', 'TEXT');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_stock_documents_status ON stock_documents(status);
            CREATE INDEX IF NOT EXISTS idx_stock_documents_type_status ON stock_documents(doc_type, status);
        `);

        db.exec(`
            UPDATE stock_documents
            SET posted_by = COALESCE(posted_by, created_by)
            WHERE status = 'posted' AND posted_by IS NULL
        `);
    });
}

function runStockDocumentReversalMigration(db) {
    if (!hasTable(db, 'stock_documents')) return;

    applyMigration(db, '005_stock_document_reversal_fields', () => {
        addColumnIfMissing(db, 'stock_documents', 'is_reversal', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'stock_documents', 'reversal_of_document_id', 'INTEGER REFERENCES stock_documents(id)');
        addColumnIfMissing(db, 'stock_documents', 'reversed_by_document_id', 'INTEGER REFERENCES stock_documents(id)');
        addColumnIfMissing(db, 'stock_documents', 'reversed_at', 'TEXT');
        addColumnIfMissing(db, 'stock_documents', 'reversal_reason', 'TEXT');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_stock_documents_reversal_of ON stock_documents(reversal_of_document_id);
            CREATE INDEX IF NOT EXISTS idx_stock_documents_reversed_by ON stock_documents(reversed_by_document_id);
        `);
    });
}

function runShipmentDocumentLinkMigration(db) {
    if (!hasTable(db, 'shipments')) return;

    applyMigration(db, '006_shipment_stock_document_link', () => {
        addColumnIfMissing(db, 'shipments', 'stock_document_id', 'INTEGER REFERENCES stock_documents(id)');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_shipments_stock_document ON shipments(stock_document_id);
        `);

        if (hasTable(db, 'stock_documents')) {
            db.exec(`
                UPDATE shipments
                SET stock_document_id = (
                    SELECT sd.id
                    FROM stock_documents sd
                    WHERE sd.doc_type = 'shipment_execution'
                      AND (sd.doc_no = shipments.shipment_no OR sd.reference_no = shipments.shipment_no)
                    ORDER BY sd.id DESC
                    LIMIT 1
                )
                WHERE stock_document_id IS NULL
            `);
        }
    });
}

function runProductionDocumentLinkMigration(db) {
    if (!hasTable(db, 'production_orders')) return;

    applyMigration(db, '007_production_stock_document_links', () => {
        addColumnIfMissing(db, 'production_orders', 'issue_document_id', 'INTEGER REFERENCES stock_documents(id)');
        addColumnIfMissing(db, 'production_orders', 'receipt_document_id', 'INTEGER REFERENCES stock_documents(id)');
        addColumnIfMissing(db, 'production_orders', 'return_document_id', 'INTEGER REFERENCES stock_documents(id)');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_production_issue_document ON production_orders(issue_document_id);
            CREATE INDEX IF NOT EXISTS idx_production_receipt_document ON production_orders(receipt_document_id);
            CREATE INDEX IF NOT EXISTS idx_production_return_document ON production_orders(return_document_id);
        `);
    });
}

function runProductionSnapshotMigration(db) {
    if (!hasTable(db, 'production_orders')) return;

    applyMigration(db, '008_production_order_snapshots', () => {
        addColumnIfMissing(db, 'production_orders', 'snapshot_created_at', 'TEXT');
        addColumnIfMissing(db, 'production_orders', 'sop_snapshot_json', 'TEXT');
        addColumnIfMissing(db, 'production_orders', 'bom_snapshot_json', 'TEXT');
        addColumnIfMissing(db, 'production_orders', 'workorder_snapshot_json', 'TEXT');

        db.exec(`
            UPDATE production_orders
            SET snapshot_created_at = COALESCE(snapshot_created_at, created_at)
            WHERE snapshot_created_at IS NULL
        `);
    });
}

function runStockDocumentOriginMigration(db) {
    if (!hasTable(db, 'stock_documents')) return;

    applyMigration(db, '009_stock_document_origin_links', () => {
        addColumnIfMissing(db, 'stock_documents', 'origin_type', 'TEXT');
        addColumnIfMissing(db, 'stock_documents', 'origin_id', 'INTEGER');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_stock_documents_origin ON stock_documents(origin_type, origin_id);
        `);

        if (hasTable(db, 'shipments')) {
            db.exec(`
                UPDATE stock_documents
                SET origin_type = 'shipment',
                    origin_id = (
                        SELECT s.id
                        FROM shipments s
                        WHERE s.stock_document_id = stock_documents.id
                        LIMIT 1
                    )
                WHERE origin_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM shipments s WHERE s.stock_document_id = stock_documents.id
                  )
            `);
        }

        if (hasTable(db, 'production_orders')) {
            db.exec(`
                UPDATE stock_documents
                SET origin_type = 'production_order',
                    origin_id = (
                        SELECT po.id
                        FROM production_orders po
                        WHERE po.issue_document_id = stock_documents.id
                           OR po.receipt_document_id = stock_documents.id
                           OR po.return_document_id = stock_documents.id
                        ORDER BY po.id DESC
                        LIMIT 1
                    )
                WHERE origin_id IS NULL
                  AND EXISTS (
                      SELECT 1
                      FROM production_orders po
                      WHERE po.issue_document_id = stock_documents.id
                         OR po.receipt_document_id = stock_documents.id
                         OR po.return_document_id = stock_documents.id
                  )
            `);
        }
    });
}

function runProductionPartialProgressMigration(db) {
    if (!hasTable(db, 'production_orders')) return;

    applyMigration(db, '010_production_partial_progress_fields', () => {
        addColumnIfMissing(db, 'production_orders', 'returned_quantity', 'REAL DEFAULT 0');

        db.exec(`
            UPDATE production_orders
            SET returned_quantity = COALESCE(returned_quantity, 0)
            WHERE returned_quantity IS NULL
        `);
    });
}

function runProductionExceptionMigration(db) {
    if (!hasTable(db, 'production_orders')) return;

    applyMigration(db, '011_production_exceptions', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS production_exceptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exception_no TEXT NOT NULL UNIQUE,
                order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
                exception_type TEXT NOT NULL CHECK(exception_type IN ('scrap', 'supplement', 'over_issue', 'variance')),
                direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
                material_id INTEGER NOT NULL REFERENCES materials(id),
                quantity REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'reversed', 'voided')),
                is_reversal INTEGER NOT NULL DEFAULT 0,
                reversal_of_exception_id INTEGER REFERENCES production_exceptions(id),
                reversed_by_exception_id INTEGER REFERENCES production_exceptions(id),
                reversed_at TEXT,
                reversal_reason TEXT,
                notes TEXT,
                stock_document_id INTEGER REFERENCES stock_documents(id),
                created_by INTEGER REFERENCES users(id),
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_production_exceptions_order ON production_exceptions(order_id);
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_type ON production_exceptions(exception_type);
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_doc ON production_exceptions(stock_document_id);
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_reversal_of ON production_exceptions(reversal_of_exception_id);
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_reversed_by ON production_exceptions(reversed_by_exception_id);
        `);
    });
}

function runProductionExceptionWorkflowMigration(db) {
    if (!hasTable(db, 'production_exceptions')) return;

    applyMigration(db, '012_production_exception_workflow_fields', () => {
        addColumnIfMissing(db, 'production_exceptions', 'status', "TEXT NOT NULL DEFAULT 'posted'");
        addColumnIfMissing(db, 'production_exceptions', 'is_reversal', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'production_exceptions', 'reversal_of_exception_id', 'INTEGER REFERENCES production_exceptions(id)');
        addColumnIfMissing(db, 'production_exceptions', 'reversed_by_exception_id', 'INTEGER REFERENCES production_exceptions(id)');
        addColumnIfMissing(db, 'production_exceptions', 'reversed_at', 'TEXT');
        addColumnIfMissing(db, 'production_exceptions', 'reversal_reason', 'TEXT');

        db.exec(`
            UPDATE production_exceptions
            SET status = COALESCE(status, 'posted'),
                is_reversal = COALESCE(is_reversal, 0)
            WHERE status IS NULL OR is_reversal IS NULL
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_reversal_of ON production_exceptions(reversal_of_exception_id);
            CREATE INDEX IF NOT EXISTS idx_production_exceptions_reversed_by ON production_exceptions(reversed_by_exception_id);
        `);
    });
}

function runMaterialSupplyModeMigration(db) {
    if (!hasTable(db, 'materials')) return;

    applyMigration(db, '013_material_supply_mode', () => {
        addColumnIfMissing(db, 'materials', 'supply_mode', "TEXT DEFAULT 'direct_issue'");

        db.exec(`
            UPDATE materials
            SET supply_mode = CASE
                WHEN COALESCE(supply_mode, '') != '' THEN supply_mode
                WHEN material_type = 'wip' THEN 'prebuild_wip'
                WHEN material_type IN ('raw', 'consumable', 'packaging', 'spare') THEN 'purchase_only'
                ELSE 'direct_issue'
            END
        `);
    });
}

function runDualWarningModelMigration(db) {
    if (!hasTable(db, 'materials')) return;

    applyMigration(db, '014_dual_warning_model', () => {
        addColumnIfMissing(db, 'materials', 'target_coverage_qty', 'REAL DEFAULT 0');

        db.exec(`
            UPDATE materials
            SET target_coverage_qty = CASE
                WHEN COALESCE(target_coverage_qty, 0) > 0 THEN target_coverage_qty
                WHEN material_type = 'finished' THEN 1
                WHEN material_type = 'wip' THEN 2
                ELSE 0
            END
        `);
    });
}

function runMaterialSupplierEnrichmentMigration(db) {
    if (!hasTable(db, 'material_suppliers')) return;

    applyMigration(db, '016_material_supplier_enrichment', () => {
        addColumnIfMissing(db, 'material_suppliers', 'supplier_type', "TEXT DEFAULT 'distributor'");
        addColumnIfMissing(db, 'material_suppliers', 'source_platform', "TEXT DEFAULT 'offline'");
        addColumnIfMissing(db, 'material_suppliers', 'shop_name', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'shop_url', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'purchase_url', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'contact_person', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'contact_phone', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'manufacturer_name', 'TEXT');
        addColumnIfMissing(db, 'material_suppliers', 'origin_region', 'TEXT');

        db.exec(`
            UPDATE material_suppliers
            SET supplier_type = COALESCE(NULLIF(TRIM(supplier_type), ''), 'distributor'),
                source_platform = COALESCE(NULLIF(TRIM(source_platform), ''), 'offline')
        `);
    });
}

function runSupplyRiskModelMigration(db) {
    if (!hasTable(db, 'materials')) return;

    applyMigration(db, '017_supply_risk_model', () => {
        addColumnIfMissing(db, 'materials', 'is_single_source', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'coverage_days_target', 'REAL DEFAULT 0');
        addColumnIfMissing(db, 'materials', 'supply_risk_level', "TEXT DEFAULT 'normal'");
        addColumnIfMissing(db, 'materials', 'supply_risk_notes', 'TEXT');

        db.exec(`
            UPDATE materials
            SET supply_risk_level = COALESCE(NULLIF(TRIM(supply_risk_level), ''), 'normal')
        `);
    });
}

function runMaterialSupplierPricesMigration(db) {
    if (!hasTable(db, 'materials')) return;

    applyMigration(db, '018_material_supplier_prices', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS material_supplier_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
                supplier_name TEXT NOT NULL,
                supplier_code TEXT,
                quoted_price REAL DEFAULT 0,
                quoted_discount REAL DEFAULT 1,
                effective_price REAL DEFAULT 0,
                last_purchase_price REAL DEFAULT 0,
                last_purchase_discount REAL DEFAULT 1,
                last_purchase_effective_price REAL DEFAULT 0,
                last_purchase_at TEXT,
                unit TEXT,
                spec TEXT,
                model TEXT,
                currency TEXT DEFAULT 'CNY',
                is_default INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                notes TEXT,
                raw_source TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_material_supplier_prices_material ON material_supplier_prices(material_id);
            CREATE INDEX IF NOT EXISTS idx_material_supplier_prices_supplier ON material_supplier_prices(supplier_name);
        `);
    });
}

function runMaterialSupplierPricesAlignmentMigration(db) {
    if (!hasTable(db, 'material_supplier_prices')) return;

    applyMigration(db, '019_material_supplier_prices_alignment', () => {
        addColumnIfMissing(db, 'material_supplier_prices', 'source_platform', "TEXT DEFAULT 'offline'");
        db.exec(`
            UPDATE material_supplier_prices
            SET source_platform = COALESCE(NULLIF(TRIM(source_platform), ''), 'offline')
        `);
    });
}

function runProductionSubstitutionWorkflowMigration(db) {
    applyMigration(db, '015_production_substitution_workflow', () => {
        if (hasTable(db, 'sop_materials')) {
            addColumnIfMissing(db, 'sop_materials', 'allow_substitution', 'INTEGER NOT NULL DEFAULT 0');
            addColumnIfMissing(db, 'sop_materials', 'substitution_priority', 'INTEGER DEFAULT 1');
        }

        if (hasTable(db, 'bom_items')) {
            addColumnIfMissing(db, 'bom_items', 'allow_substitution', 'INTEGER NOT NULL DEFAULT 0');
            addColumnIfMissing(db, 'bom_items', 'substitution_priority', 'INTEGER DEFAULT 1');
        }

        if (hasTable(db, 'production_orders')) {
            addColumnIfMissing(db, 'production_orders', 'substitution_plan_json', 'TEXT');
            addColumnIfMissing(db, 'production_orders', 'substitution_executed_json', 'TEXT');
        }

        if (hasTable(db, 'stock_document_items')) {
            addColumnIfMissing(db, 'stock_document_items', 'original_material_id', 'INTEGER REFERENCES materials(id)');
            addColumnIfMissing(db, 'stock_document_items', 'substitution_type', 'TEXT');
            addColumnIfMissing(db, 'stock_document_items', 'substitution_reason', 'TEXT');
        }
    });
}

function runInventoryConsistencyGovernanceMigration(db) {
    applyMigration(db, '020_inventory_consistency_governance', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS inventory_consistency_governance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issue_key TEXT NOT NULL UNIQUE,
                issue_type TEXT NOT NULL,
                material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
                warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'open',
                owner TEXT,
                notes TEXT,
                updated_by INTEGER REFERENCES users(id),
                resolved_at TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_inventory_consistency_governance_status
                ON inventory_consistency_governance(status);
            CREATE INDEX IF NOT EXISTS idx_inventory_consistency_governance_owner
                ON inventory_consistency_governance(owner);
        `);
    });
}

function runSupplyRiskGovernanceMigration(db) {
    applyMigration(db, '021_supply_risk_governance', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS supply_risk_governance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL UNIQUE REFERENCES materials(id) ON DELETE CASCADE,
                action_type TEXT NOT NULL DEFAULT 'procurement',
                status TEXT NOT NULL DEFAULT 'open',
                owner TEXT,
                notes TEXT,
                source_context TEXT,
                updated_by INTEGER REFERENCES users(id),
                resolved_at TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_supply_risk_governance_status
                ON supply_risk_governance(status);
            CREATE INDEX IF NOT EXISTS idx_supply_risk_governance_owner
                ON supply_risk_governance(owner);
            CREATE INDEX IF NOT EXISTS idx_supply_risk_governance_action_type
                ON supply_risk_governance(action_type);
        `);
    });
}

function inferBomLevelFromName(name = '') {
    const value = String(name || '').trim();
    const levels = ['整机', '模块', '板级', '配套件'];
    return levels.find(level => value.startsWith(`${level}_`) || value.startsWith(level)) || null;
}

function normalizeBomDisplayVersion(value, fallback = 'V01') {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return fallback;
    const direct = raw.match(/^V(\d{2})$/);
    if (direct) return `V${direct[1]}`;
    const numeric = raw.match(/(\d{1,2})/);
    if (numeric) return `V${String(Number(numeric[1] || 1)).padStart(2, '0')}`;
    return fallback;
}

function evaluateBomNamingSnapshot(name, bomLevel, displayVersion) {
    const issues = [];
    const value = String(name || '');
    if (!bomLevel) issues.push({ code: 'missing_level', label: '未设置 BOM 层级', severity: 'warning' });
    if (bomLevel && !value.startsWith(`${bomLevel}_`)) issues.push({ code: 'prefix_mismatch', label: '名称未按层级前缀命名', severity: 'error' });
    if (!new RegExp(`_${displayVersion}$`, 'i').test(value)) issues.push({ code: 'missing_version_suffix', label: '名称未以标准版本尾缀结尾', severity: 'warning' });
    if (/20\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}日?/.test(value) || /20\d{6}/.test(value)) issues.push({ code: 'date_in_name', label: '名称中包含日期信息', severity: 'error' });
    ['.BOM', 'BOM', '模板', '最新版', '最终版', '新版', '改版'].forEach(token => {
        const matched = token === 'BOM' ? (/\bBOM\b/i.test(value) || /\.BOM/i.test(value)) : value.includes(token);
        if (matched) issues.push({ code: `forbidden_${token}`, label: `名称中包含禁用词 ${token}`, severity: 'error' });
    });
    return {
        issues,
        status: !issues.length ? 'compliant' : issues.some(item => item.severity === 'error') ? 'non_compliant' : 'warning'
    };
}

function runBomNamingGovernanceMigration(db) {
    if (!hasTable(db, 'boms')) return;

    applyMigration(db, '022_bom_naming_governance', () => {
        addColumnIfMissing(db, 'boms', 'bom_level', 'TEXT');
        addColumnIfMissing(db, 'boms', 'display_version', "TEXT DEFAULT 'V01'");
        addColumnIfMissing(db, 'boms', 'naming_status', "TEXT DEFAULT 'warning'");
        addColumnIfMissing(db, 'boms', 'naming_issues_json', 'TEXT');
        addColumnIfMissing(db, 'boms', 'suggested_name', 'TEXT');
        addColumnIfMissing(db, 'boms', 'naming_checked_at', 'TEXT');

        const rows = db.prepare('SELECT id, name, version, bom_level, display_version FROM boms').all();
        const stmt = db.prepare(`
            UPDATE boms
            SET bom_level = ?, display_version = ?, naming_status = ?, naming_issues_json = ?, suggested_name = ?, naming_checked_at = datetime('now','localtime')
            WHERE id = ?
        `);
        rows.forEach(row => {
            const bomLevel = row.bom_level || inferBomLevelFromName(row.name) || null;
            const displayVersion = normalizeBomDisplayVersion(row.display_version || row.version || 'V01');
            const evaluation = evaluateBomNamingSnapshot(row.name, bomLevel, displayVersion);
            const sanitizedName = String(row.name || '')
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(new RegExp(`_${displayVersion}$`, 'i'), '');
            const suggestedName = [bomLevel || '模块', sanitizedName, displayVersion].filter(Boolean).join('_');
            stmt.run(
                bomLevel,
                displayVersion,
                evaluation.status,
                JSON.stringify(evaluation.issues),
                suggestedName,
                row.id
            );
        });
    });
}

function runProductionExceptionGovernanceMigration(db) {
    if (!hasTable(db, 'production_exceptions')) return;

    applyMigration(db, '023_production_exception_governance', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS production_exception_governance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exception_id INTEGER NOT NULL UNIQUE REFERENCES production_exceptions(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'open',
                owner TEXT,
                notes TEXT,
                updated_by INTEGER REFERENCES users(id),
                resolved_at TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_production_exception_governance_status
                ON production_exception_governance(status);
            CREATE INDEX IF NOT EXISTS idx_production_exception_governance_owner
                ON production_exception_governance(owner);
        `);
    });
}

function runHistoricalPurchaseRecordsMigration(db) {
    applyMigration(db, '024_historical_purchase_records', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS purchase_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_date TEXT NOT NULL,
                order_no TEXT NOT NULL UNIQUE,
                supplier_name TEXT NOT NULL,
                warehouse_name TEXT,
                quantity REAL DEFAULT 0,
                amount REAL DEFAULT 0,
                paid_amount REAL DEFAULT 0,
                unpaid_amount REAL DEFAULT 0,
                source_file TEXT,
                raw_source TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_purchase_records_order_date
                ON purchase_records(order_date);
            CREATE INDEX IF NOT EXISTS idx_purchase_records_supplier
                ON purchase_records(supplier_name);
            CREATE INDEX IF NOT EXISTS idx_purchase_records_warehouse
                ON purchase_records(warehouse_name);
        `);
    });
}

function runStockDocumentRevisionMigration(db) {
    applyMigration(db, '025_stock_document_revisions', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS stock_document_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
                revision_no INTEGER NOT NULL,
                from_status TEXT,
                to_status TEXT,
                edited_by INTEGER REFERENCES users(id),
                change_reason TEXT,
                before_snapshot TEXT,
                after_snapshot TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(document_id, revision_no)
            );
            CREATE INDEX IF NOT EXISTS idx_stock_document_revisions_document
                ON stock_document_revisions(document_id);
            CREATE INDEX IF NOT EXISTS idx_stock_document_revisions_editor
                ON stock_document_revisions(edited_by);
        `);
    });
}

function runHistoricalPurchaseRecordItemsMigration(db) {
    applyMigration(db, '026_historical_purchase_record_items', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS purchase_record_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id INTEGER NOT NULL REFERENCES purchase_records(id) ON DELETE CASCADE,
                line_no INTEGER NOT NULL,
                item_code TEXT,
                item_name TEXT,
                spec TEXT,
                model TEXT,
                brand TEXT,
                unit TEXT,
                quantity REAL DEFAULT 0,
                unit_price REAL DEFAULT 0,
                amount REAL DEFAULT 0,
                note TEXT,
                raw_source TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(record_id, line_no)
            );
            CREATE INDEX IF NOT EXISTS idx_purchase_record_items_record
                ON purchase_record_items(record_id);
            CREATE INDEX IF NOT EXISTS idx_purchase_record_items_code
                ON purchase_record_items(item_code);
        `);
    });
}

function runMigrations(db) {
    ensureMigrationsTable(db);
    runLegacyMigrations(db);
    runMaterialMasterMigration(db);
    runWarehouseActionDocumentMigration(db);
    runStockExecutionDocumentStorageMigration(db);
    runExecutionTimestampLocalizationMigration(db);
    runStockDocumentWorkflowMigration(db);
    runStockDocumentReversalMigration(db);
    runShipmentDocumentLinkMigration(db);
    runProductionDocumentLinkMigration(db);
    runProductionSnapshotMigration(db);
    runStockDocumentOriginMigration(db);
    runProductionPartialProgressMigration(db);
    runProductionExceptionMigration(db);
    runProductionExceptionWorkflowMigration(db);
    runMaterialSupplyModeMigration(db);
    runDualWarningModelMigration(db);
    runMaterialSupplierEnrichmentMigration(db);
    runSupplyRiskModelMigration(db);
    runMaterialSupplierPricesMigration(db);
    runMaterialSupplierPricesAlignmentMigration(db);
    runProductionSubstitutionWorkflowMigration(db);
    runInventoryConsistencyGovernanceMigration(db);
    runSupplyRiskGovernanceMigration(db);
    runBomNamingGovernanceMigration(db);
    runProductionExceptionGovernanceMigration(db);
    runHistoricalPurchaseRecordsMigration(db);
    runStockDocumentRevisionMigration(db);
    runHistoricalPurchaseRecordItemsMigration(db);
}

module.exports = { runMigrations };
