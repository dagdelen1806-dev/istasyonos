# Faz 5B.7 - Isolated OSEE accounting browser/operator check

The command bundles a synthetic React fixture and serves it on loopback only. Browser fetch calls are mocked; it never connects to the application API, MySQL, DEMO/main/Aksan databases, or external OCR. PASS is reported only after every DOM result attribute passes. The fixture records any non-GET fetch as a test failure.

## Normal Windows PowerShell

```powershell
Set-Location 'C:\laragon\www\istasyonos-main'
node .\scripts\staffing-browser-test.mjs
```

The runner does one isolated `about:blank` smoke first and starts the synthetic
DOM harness only after `BROWSER_SMOKE_PASS`. If Chrome exits before requesting
the fixture page, it reports `BROWSER_NOT_RUN: BROWSER_EARLY_EXIT`; no assertion
failure is reported because no DOM assertions ran. This command does not need
`CHROME_BIN`; when set, that executable is checked and reported without
falling back to another browser if invalid.

```powershell
node --check .\scripts\staffing-browser-test.mjs
```

For a standalone smoke diagnostic, use `node .\scripts\browser-smoke.mjs`
instead of running both scripts in the same verification. It opens only
`about:blank`; it does not contact the application or network.

The browser helper reports executable, launch arguments and stage timings. It
has a bounded runtime and terminates only the process tree started by the test.
Profiles are unique under `.local` and removed afterward. It does not alter the
normal Chrome/Edge profile or disable browser security.

If headless smoke fails or Chrome exits without producing a DOM result, do not
repeatedly retry the same launch. The `--manual` mode does not run the smoke,
does not locate or launch Chrome, and does not create a browser profile. It
serves the synthetic fixture over loopback for the operator's already-open
normal browser:

```powershell
node .\scripts\staffing-browser-test.mjs --manual
```

The terminal prints `MANUAL_SERVER_READY` with the active `127.0.0.1` host,
port, and unique `http://127.0.0.1:<port>/` URL. Open that URL in
the normal browser. The page is a synthetic UI review only: it does not call the
real application API, MySQL, or external services. The harness may create
synthetic IndexedDB data under that exact, ephemeral loopback origin. It never
uses the application origin or the user's browser profile data for the local
application.

The manual fixture stylesheet is built through the project's `vite.config.ts`
and Tailwind Vite plugin from `client/src/index.css`, `client/src/station.css`,
and `client/src/components/stationos/business.css`. The server serves it as
`/styles.css`; its endpoint test requires HTTP 200, `text/css`, non-empty
content, and StationOS mobile/panel selectors. A visible red warning appears
if the browser stylesheet request fails. In Chrome DevTools, emulate a 390 ×
844 viewport and confirm the OSEE panel remains within the viewport. This
manual visual inspection is distinct from the runner's automated CSS-load and
layout assertions.

After review, click the storage cleanup link in the banner. The loopback server
returns `Clear-Site-Data: "storage"` for only that host/port origin and keeps
running. Close the tab, then stop the server with Ctrl+C or the separate
**Sentetik sunucuyu kapat** button. The page's shutdown action has a random
per-session token and is separate from storage cleanup. The server remains
open until Ctrl+C or that explicit action. This flow reports visual/manual
review, never automated DOM PASS. If cleanup cannot be confirmed, clear site
data for that exact localhost origin in browser settings before using the
synthetic page again.

The synthetic browser checks cover:

- OSEE cash, card slip, IBAN, FAST, debt/current account and special transaction display as separate categories. Special operations are excluded from the payment/cari subtotal.
- No automation person row means the mobile sales difference remains uncalculated.
- FAST is disabled when the 0018 capability is false. POS upload/OCR is hidden when the complete 0019 schema capability is false; server endpoints reject unavailable schema with `POS_SLIP_MIGRATION_REQUIRED`.
- Accountant screen shows the immutable first snapshot separately from the automation staff row. Exact tenant, station, date, shift, and person scope mismatch suppresses the comparison. A shift ID/time mismatch prevents source reads.
- Missing independent day-end keeps `SOURCE_PENDING`; correction remains temporary, first snapshot remains unchanged, and no financial write request is issued.
- API failures are visible. Label containment/focus and a 390px synthetic viewport overflow smoke check are recorded.

All result markers must pass: `data-test-result`, `data-reconciliation-result`, `data-financial-review-result`, `data-mobile-sales-gate-result`, `data-scope-mismatch-result`, `data-api-error-result`, `data-accessibility-result`, and `data-mobile-layout-result`. The harness does not load production stylesheets, so its viewport check is not a production CSS/device layout certification. Real keyboard traversal and Android/iPhone checks remain separate.

If Chrome/Edge crashes or reports startup errors, the runner emits
`BROWSER_NOT_RUN` or `BROWSER_FAIL` with exit code, signal, spawn error code,
close reason, stdout/stderr byte counts, request stages and timings. It checks
that the executable is a readable file, its unique profile is under `.local`
and writable, no known profile lock exists, and the OS temp directory is
readable/writable. It cleans only the profile it created. Do not repeatedly
retry the same environment. Use the isolated `--manual` session and checklist
below; manual review is not an automated DOM PASS.

### Read-only Windows crash-event check

After a single failed smoke, this PowerShell query checks recent Application
Error / Windows Error Reporting event IDs and prints only application name,
version, faulting module and exception code. It intentionally omits event
messages and executable/profile paths:

```powershell
$since = (Get-Date).AddMinutes(-30)
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001; StartTime = $since } -ErrorAction SilentlyContinue |
  ForEach-Object {
    $event = $_
    $fields = @{}
    $xml = [xml]$event.ToXml()
    foreach ($item in $xml.Event.EventData.Data) {
      if ([string]$item.Name -in @('AppName', 'AppVersion', 'ModuleName', 'ModuleVersion', 'ExceptionCode')) {
        $fields[[string]$item.Name] = $item.InnerText
      }
    }
    if ($fields.AppName -match '^(chrome|msedge)\.exe$') {
      [pscustomobject]@{
        Time = $event.TimeCreated
        EventId = $event.Id
        Provider = $event.ProviderName
        App = $fields.AppName
        AppVersion = $fields.AppVersion
        Module = $fields.ModuleName
        ModuleVersion = $fields.ModuleVersion
        ExceptionCode = $fields.ExceptionCode
      }
    }
  } | Format-List
```

This is read-only. If Windows denies event-log access, report that as
`NOT_RUN`; do not elevate the session for this check.

## Manual review when BROWSER_NOT_RUN

- At 390x844 and on a phone, verify no horizontal page overflow, labels remain visible, and controls can be reached with keyboard/tab order.
- With no automation row, confirm automation total and sales variance are unavailable; payment/cari totals remain distinct from sale totals and TTS/Gift/special rows remain separate.
- Confirm first declaration snapshot is read-only; tenant/station/person/date/shift mismatch does not display a comparison; independent day-end absence remains pending.
- Confirm missing source, empty report, loading and API error states are understandable.
- Confirm FAST is unavailable while 0018 is absent and POS OCR is unavailable while 0019 schema is absent.
- Confirm correction is draft-only; no approved reconciliation, employee debt, wage deduction or accounting record appears.
- In the synthetic manager panel, verify the invite preview is limited to
  `FUEL_STAFF` and the manager's authorized station; no invite is sent to a real
  account. Confirm the 0020-dependent assignment control remains disabled.
- In the synthetic OSEE panel, verify only the assigned open shift appears.
  Review cash, IBAN/transfer and debt entries in the local pending queue; there
  is no FAST or POS OCR migration capability in the fixture.
- Confirm account submission remains pending until a server acknowledgement;
  the harness intentionally has no backend and sends no write request.
- In the accountant panel, compare the immutable declaration snapshot and
  automation row, inspect the reasoned correction draft, and confirm the
  independent day-end source is still pending.
- Check the diagnostics block for failed assertion names and masked values. Do
  not treat this synthetic view as a real invitation, login, API, MySQL, or
  financial workflow test.

For the 5B.9C mobile review, the harness also requires a visible, named label
for its form controls, accessible names on rendered buttons, keyboard focus on a
labeled control, and an assertive validation alert after invalid amount entry.
The browser DOM harness measures the isolated OSEE root at 390 CSS pixels after
loading the compiled application stylesheet. The localhost HTTP test separately
checks the responsive 560/360 px rules and `:focus-visible` CSS; those static
checks do not certify actual rendered overflow. In manual Chrome/Edge device
emulation, set the viewport to 390 x 844 and inspect the payment form, status
messages, and horizontal scroll. Manual visual review is not a DOM assertion
PASS.

## Boundaries

This browser runbook does not apply migrations, seed, or write any database. 0018/0019 remain unapplied; 0020 remains outside the migration catalogue. MySQL migration status remains NO-GO.

## Faz 5B.8D operatör notu

`metadataSourceFields` eksik legacy taslakta muhasebe paneli artık kaynak konumu için “kaynak yok” gösterir. Harness, ayrıca aynı sözleşmeli bir otomasyon fixture'ıyla asıl muhasebe görünümünü test eder. Mobil shift-choice kontrolü başlangıç formunun ayrı sentetik ekranında yapılır; aktif hesap görünümü de atanmış vardiya adını ayrı doğrular. Mobil genişlik assertion'ı yalnız mobil fixture kökünü ölçer; bu harness üretim CSS'i/gerçek cihaz testi değildir.

Yeni DOM runner tüm zorunlu sonuç işaretlerini bekler ve console/page error varsa PASS vermez. Chrome smoke PASS ise normal doğrulama komutu `node .\scripts\staffing-browser-test.mjs`; browser hâlâ başlamazsa görünür, izole sentetik inceleme için `node .\scripts\staffing-browser-test.mjs --manual` kullanılabilir. İki mod da uygulama API'sine/MySQL'e bağlanmaz.
