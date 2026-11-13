import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { splitSql } from "../migrations/catalog";

describe("kanonik personel ve vardiya atama migrationı", () => {
  it("dar DDL profilinde tenant kapsamını kurar ve eski erişimi açmaz", async () => {
    const sql = await readFile(
      new URL(
        "./migrations/0020_personnel_shift_assignments.sql",
        import.meta.url
      ),
      "utf8"
    );
    const statements = splitSql(sql);
    const ddl = statements.map(statement =>
      statement.replace(/^--.*\n/gm, "").trim()
    );
    expect(statements).toHaveLength(5);
    expect(ddl[0]).toMatch(/^ALTER TABLE st_stations/i);
    expect(ddl[1]).toMatch(/^ALTER TABLE st_member_stations/i);
    expect(ddl[2]).toMatch(/^ALTER TABLE st_shifts/i);
    expect(ddl[3]).toMatch(/^CREATE TABLE st_shift_assignments/i);
    expect(ddl[4]).toMatch(/^CREATE TABLE st_staffing_events/i);
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id, station_id\)\s+REFERENCES st_stations\(tenant_id, id\)/i
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id, station_id, shift_id\)\s+REFERENCES st_shifts\(tenant_id, station_id, id\)/i
    );
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
    expect(sql).toMatch(
      /status ENUM\('ACTIVE','INACTIVE','REVIEW_REQUIRED'\) NOT NULL DEFAULT 'REVIEW_REQUIRED'/i
    );
    expect(sql).not.toMatch(/DEFAULT 'ACTIVE'/i);
    expect(sql).toMatch(
      /status ENUM\('ASSIGNED','REMOVED'\) NOT NULL DEFAULT 'REMOVED'/i
    );
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id, user_id, station_id\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id, assigned_by_user_id\)/i);
    expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
  });
});
