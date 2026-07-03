# LOZI · App Screen Snapshots

A complete visual snapshot of every screen in the LOZI (لوزي) app, captured with
Playwright at a **390 × 844** mobile viewport (standard phone, 2× DPI) to reflect
how the app actually looks on a phone. Full-page captures, numbered in the order
they were taken.

The app is a right-to-left (RTL) Arabic single-page app. Screenshots were driven
against a local mirror of the production database, signed in as one test account
per user category. Product/store images that had no uploaded asset render as the
app's built-in placeholder ("صورة المنتج") — shown here with a neutral "LOZI demo
image" swatch — so any placeholder you see is a missing image in the data, not a
capture error.

## Auth & onboarding (logged out)

| # | File | Screen |
|---|------|--------|
| 01 | `01-onboarding-choose-role.png` | Account-type picker — the 4 categories: customer (زبون), farmer (مزارع), retail (محل تجزئة), wholesale (محل جملة) |
| 02 | `02-register-customer.png` | Customer registration (name · email · password · phone) |
| 03 | `03-register-farmer-choose-crop.png` | Farmer onboarding — crop-type step (almond / raisin) |
| 04 | `04-register-farmer-form.png` | Vendor registration form (4-part legal name + phone) — farmer |
| 05 | `05-register-retail.png` | Vendor registration form — retail store |
| 06 | `06-register-wholesale.png` | Vendor registration form — wholesale store |
| 07 | `07-login-customer-email.png` | Login — customer tab (email + password) |
| 08 | `08-login-vendor-phone.png` | Login — store/farmer tab (phone + password) |
| 09 | `09-forgot-password.png` | Forgot-password / reset flow |

> Customers register with **email**; farmers, retail and wholesale vendors register
> with **phone** (same vendor form, role chosen on the picker screen).

## Customer (signed in)

| # | File | Screen |
|---|------|--------|
| 10 | `10-customer-home.png` | Home / marketplace — categories, featured stores, today's offers |
| 11 | `11-product-detail.png` | Product detail — price, type, weight/amount toggle, add to cart |
| 12 | `12-store-page.png` | Public store page (storefront) |
| 13 | `13-sections-browse.png` | Sections / browse — sort, filters, segment & variety chips |
| 14 | `14-savings-section.png` | Savings section (خانة التوفير) + VIP market entry |
| 15 | `15-vip-market.png` | VIP market (سوق VIP) |
| 16 | `16-cart.png` | Cart with an item |
| 17 | `17-checkout.png` | Checkout — address, order summary, payment, totals |
| 18 | `18-customer-account.png` | Account home |
| 19 | `19-personal-info.png` | Personal information (معلوماتي الشخصية) |
| 20 | `20-my-orders.png` | My orders (طلباتي) — empty state |
| 21 | `21-favorites.png` | Favorites (المفضّلة) |
| 22 | `22-reports.png` | Reports (البلاغات) — empty state |
| 23 | `23-settings.png` | Settings (الإعدادات) — currency, theme, language |
| 24 | `24-chat-list.png` | Chat — conversation list |
| 25 | `25-chat-conversation.png` | Chat — an open conversation |

## Vendor (signed in)

| # | File | Screen |
|---|------|--------|
| 26 | `26-vendor-home-wholesale.png` | Vendor home / marketplace (wholesale) with seller banners |
| 27 | `27-vendor-dashboard-orders.png` | Seller dashboard / orders (لوحة التحكم) — wholesale |
| 28 | `28-vendor-business-profile.png` | Business profile editor (الملف التجاري) |
| 29 | `29-vendor-offers.png` | Offers editor (العروض) — discount & free delivery |
| 30 | `30-vendor-reviews.png` | Reviews tab (التقييمات) |
| 31 | `31-vendor-add-product.png` | Add-product form (verified vendor) |
| 32 | `32-vendor-dashboard-farmer.png` | Seller dashboard — farmer |
| 33 | `33-vendor-dashboard-retail.png` | Seller dashboard — retail |
| 34 | `34-vendor-verification-sheet.png` | Account verification / document upload (توثيق الحساب) — gate before publishing |
