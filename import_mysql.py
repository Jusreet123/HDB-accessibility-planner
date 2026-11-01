import csv
import time
from pathlib import Path
from getpass import getpass

import mysql.connector


# ==========================================
# 1. Aiven MySQL connection settings
# ==========================================

DB_HOST = "mysql-3f901b5d-smart-hdb-planner.b.aivencloud.com"
DB_PORT = 16808
DB_NAME = "defaultdb"
DB_USER = "avnadmin"

CA_CERT = r"C:\Yi Wei\SIT\Year 3\Y3T1\Database Systems\Group Project\ca.pem"


# ==========================================
# 2. CSV file and table settings
# ==========================================

BASE_DIR = Path(__file__).resolve().parent

CSV_FILE = (
    BASE_DIR
    / "pipeline_output"
    / "tables"
    / "resale_transaction.csv"
)

TABLE_NAME = "resale_transaction"
BATCH_SIZE = 1000

EXPECTED_ROWS = 987234


# ==========================================
# 3. Check that the CSV exists
# ==========================================

print("CSV file:", CSV_FILE)

if not CSV_FILE.is_file():
    raise FileNotFoundError(
        f"Cannot find CSV file: {CSV_FILE}"
    )


# ==========================================
# 4. Connect securely to Aiven MySQL
# ==========================================

password = getpass("Enter your Aiven MySQL password: ")

connection = mysql.connector.connect(
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
    user=DB_USER,
    password=password,
    ssl_ca=CA_CERT,
    ssl_verify_cert=True,
    connection_timeout=30
)

cursor = connection.cursor()

try:
    print("\nConnected to Aiven MySQL.")

    # ==========================================
    # 5. Check existing records
    # ==========================================

    cursor.execute(
        "SELECT COUNT(*) FROM resale_transaction"
    )

    starting_count = cursor.fetchone()[0]

    print(
        f"Existing resale transactions: {starting_count:,}"
    )

    # ==========================================
    # 6. Read CSV and validate columns
    # ==========================================

    with CSV_FILE.open(
        "r",
        encoding="utf-8-sig",
        newline=""
    ) as file:

        reader = csv.DictReader(file)
        columns = reader.fieldnames

        if not columns:
            raise ValueError(
                "The CSV file has no column headers."
            )

        cursor.execute(
            "SHOW COLUMNS FROM resale_transaction"
        )

        database_columns = {
            row[0] for row in cursor.fetchall()
        }

        if not set(columns).issubset(database_columns):
            missing_columns = (
                set(columns) - database_columns
            )

            raise ValueError(
                f"CSV columns not found in MySQL: "
                f"{missing_columns}"
            )

        if "transaction_id" not in columns:
            raise ValueError(
                "The CSV must contain transaction_id."
            )

        # ==========================================
        # 7. Prepare SQL INSERT statement
        # ==========================================

        column_sql = ", ".join(
            f"`{col}`" for col in columns
        )

        placeholders = ", ".join(
            ["%s"] * len(columns)
        )

        # Duplicate transaction IDs are skipped.
        # Other data errors are still reported.

        sql = (
            f"INSERT INTO `{TABLE_NAME}` "
            f"({column_sql}) "
            f"VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE "
            f"`transaction_id` = `transaction_id`"
        )

        # ==========================================
        # 8. Import data in batches
        # ==========================================

        batch = []
        processed = 0
        start_time = time.time()

        def save_batch(rows):
            cursor.executemany(sql, rows)
            connection.commit()

        for row in reader:

            values = []

            for col in columns:
                value = row[col]

                if value is None or value.strip() == "":
                    value = None

                elif value.strip().lower() == "true":
                    value = 1

                elif value.strip().lower() == "false":
                    value = 0

                values.append(value)

            batch.append(tuple(values))

            if len(batch) >= BATCH_SIZE:

                save_batch(batch)

                processed += len(batch)
                batch.clear()

                if processed % 10000 == 0:
                    elapsed = time.time() - start_time

                    print(
                        f"Processed {processed:,} / "
                        f"{EXPECTED_ROWS:,} rows "
                        f"| Elapsed: {elapsed:.0f}s",
                        flush=True
                    )

        # Import remaining rows
        if batch:
            save_batch(batch)
            processed += len(batch)
            batch.clear()

    # ==========================================
    # 9. Verify the final record count
    # ==========================================

    cursor.execute(
        "SELECT COUNT(*) FROM resale_transaction"
    )

    final_count = cursor.fetchone()[0]

    print("\n================================")
    print("IMPORT FINISHED")
    print("================================")

    print(f"CSV rows processed: {processed:,}")
    print(f"Existing records before import: {starting_count:,}")
    print(f"Total records in MySQL: {final_count:,}")
    print(f"Expected records: {EXPECTED_ROWS:,}")

    if final_count == EXPECTED_ROWS:
        print("SUCCESS: Record count matches!")
    else:
        print(
            "WARNING: Record count does not match. "
            "Please verify before proceeding."
        )

except Exception as error:
    connection.rollback()
    print("\nImport stopped due to an error:")
    print(error)
    print(
        "Previously committed batches are retained. "
        "Check the database count before restarting."
    )
    raise

finally:
    cursor.close()
    connection.close()
    print("\nMySQL connection closed.")