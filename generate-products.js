#!/usr/bin/env node
/**
 * generate-products.js (v2 -- SEO + conversion pass)
 * -----------------------------------------------------------------------
 * Generates one static HTML product page per tire SKU, matching the
 * Quattro-style URL pattern:
 *   /tires/{brand-model-slug}/{width}-{aspect}-{diameter}-{loadindex}{speed}-{id}/
 *
 * What's new in v2:
 *  - Size picker: every page links to every OTHER size of the same
 *    brand+model (two-pass build so we know all sibling sizes up front)
 *  - Trust icon row: pro install available / warranty / next-day delivery /
 *    real 4.9-star Google rating (pulled from the same numbers used
 *    elsewhere on the site -- not fabricated review schema)
 *  - Similar tires in this size: top 3 alternatives from the SAME size
 *    fetch, so no client-side JS/fetch is needed -- it's baked in at
 *    generation time
 *  - Real urgency messaging: "Only N left" when stock is genuinely low,
 *    using the actual warehouse quantity -- never a fake countdown
 *  - Sticky mobile call bar (pure CSS, no JS) for one-tap conversion
 *  - JSON-LD: Product + BreadcrumbList + FAQPage (generic, factual
 *    questions only -- no fabricated AggregateRating/reviews since we
 *    don't have real per-tire review data)
 *  - Every page has a real, honest content difference (its own specs,
 *    price, size list, and 3 real alternatives) -- avoids thin/duplicate
 *    content SEO penalties
 *
 * Run with:  node generate-products.js
 * Output:    ./dist/{brand-model-slug}/{size-slug}/index.html  (one per tire)
 *            ./dist/sitemap-products.xml
 *
 * Requires Node 18+ (built-in fetch). No external dependencies.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://aged-butterfly-cd6a.samanjot146.workers.dev/api/tires';
const SITE_BASE = 'https://tires.presidentwheels.ca';
const OUT_DIR = path.join(__dirname, 'dist');

const SIZES = [
  '195/65R15', '205/55R16', '205/60R16', '215/60R16', '215/65R16',
  '225/45R17', '225/60R17', '225/65R17', '235/65R17', '235/55R18',
  '235/60R18', '245/60R18', '255/50R20', '265/70R17', '275/55R20',
  '185/65R15', '195/55R16', '205/50R17', '215/55R17', '225/55R17',
  '235/60R16', '235/65R16'
];

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sizeDims(sizeStr) {
  const m = sizeStr.match(/(\d+)\/(\d+)R(\d+)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : slugify(sizeStr);
}

function sizeSlug(sizeStr, loadIndex, speedRating) {
  return `${sizeDims(sizeStr)}-${loadIndex}${speedRating}`.toLowerCase();
}

function productUrl(tire, size) {
  const brandSlug = slugify(tire.brand);
  const modelSlug = slugify(tire.model);
  const productSlug = `${brandSlug}-${modelSlug}`;
  const sizeSlugStr = sizeSlug(size, tire.specs.loadIndex, tire.specs.speedRating);
  return {
    productSlug,
    path: `${productSlug}/${sizeSlugStr}-${tire.id}/`,
    url: `${SITE_BASE}/${productSlug}/${sizeSlugStr}-${tire.id}/`
  };
}

function sizeHubUrl(size) {
  const slug = size.replace(/\//g, '-').toLowerCase();
  return `https://presidentwheels.ca/tires-${slug}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(tire, size, siblingSizes, alternatives) {
  const built = productUrl(tire, size);
  const relPath = built.path;
  const url = built.url;
  const title = `${tire.brand} ${tire.model} - ${size} ${tire.specs.loadIndex}${tire.specs.speedRating}`;
  const priceStr = tire.price.toFixed(2);
  const msrpStr = tire.msrp ? tire.msrp.toFixed(2) : null;
  const lowStock = tire.totalStock && tire.totalStock <= 8;

  const brandE = escapeHtml(tire.brand);
  const modelE = escapeHtml(tire.model);
  const titleE = escapeHtml(title);
  const seasonE = escapeHtml(tire.specs.season);
  const imageE = escapeHtml(tire.image);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: title,
      brand: { '@type': 'Brand', name: tire.brand },
      image: tire.image,
      description: tire.brand + ' ' + tire.model + ' ' + tire.specs.season + ' tire, size ' + size + ', load index ' + tire.specs.loadIndex + ', speed rating ' + tire.specs.speedRating + '.',
      sku: tire.itemNumber,
      offers: {
        '@type': 'Offer',
        url: url,
        priceCurrency: 'CAD',
        price: priceStr,
        availability: tire.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller: { '@type': 'AutoPartsStore', name: 'President Tire & Wheels' }
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Live Search', item: SITE_BASE + '/' },
        { '@type': 'ListItem', position: 2, name: size + ' Tires', item: sizeHubUrl(size) },
        { '@type': 'ListItem', position: 3, name: tire.brand + ' ' + tire.model, item: url }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is the ' + tire.brand + ' ' + tire.model + ' in stock in ' + size + '?',
          acceptedAnswer: { '@type': 'Answer', text: tire.inStock ? ('Yes, we currently have ' + tire.totalStock + ' in stock at our warehouse with next-day delivery to our Waterloo shop.') : 'This size is currently out of stock. Call us and we can check alternative sizes or order it in.' }
        },
        {
          '@type': 'Question',
          name: 'Does the price include installation?',
          acceptedAnswer: { '@type': 'Answer', text: 'Tire price is separate from installation. We offer professional mounting, balancing, and a full tire inspection in-shop or via mobile install -- call for current install pricing, or ask about free installation when you buy a complete wheel package.' }
        },
        {
          '@type': 'Question',
          name: 'What other sizes does the ' + tire.brand + ' ' + tire.model + ' come in?',
          acceptedAnswer: { '@type': 'Answer', text: siblingSizes.length ? ('This model is also available in ' + siblingSizes.map(function(s){return s.size;}).join(', ') + '. See the size options above or call to confirm availability.') : 'Call us to check other available sizes for this model.' }
        }
      ]
    }
  ];

  const sizePicker = siblingSizes.length
    ? '<div style="margin-bottom:16px"><div style="font-size:12px;color:#8d8d8d;margin-bottom:8px">Choose your size</div><div style="display:flex;flex-wrap:wrap;gap:8px">'
      + '<span style="background:#03ff7f;color:#000;padding:8px 12px;border-radius:10px;font-size:13px;font-weight:700">' + size + '</span>'
      + siblingSizes.map(function(s){ return '<a href="' + s.url + '" style="background:#111;border:1px solid #262626;color:#c9d0cb;padding:8px 12px;border-radius:10px;font-size:13px;text-decoration:none">' + s.size + '</a>'; }).join('')
      + '</div></div>'
    : '';

  const altSection = alternatives.length
    ? '<div class="section"><h2>Other ' + size + ' Tires You Might Consider</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">'
      + alternatives.map(function(a){
          const au = productUrl(a, size).url;
          return '<a href="' + au + '" style="display:block;background:#151515;border:1px solid #1e1e1e;border-radius:12px;padding:14px;text-decoration:none"><div style="color:#8d8d8d;font-size:11px;text-transform:uppercase">' + escapeHtml(a.brand) + '</div><div style="color:#fff;font-size:13px;margin:2px 0 8px">' + escapeHtml(a.model) + '</div><div style="color:#03ff7f;font-weight:800;font-size:16px">$' + a.price.toFixed(2) + '</div></a>';
        }).join('')
      + '</div></div>'
    : '';

  let faqHtml = '';
  jsonLd[2].mainEntity.forEach(function(q) {
    faqHtml += '<div class="faqq"><h3>' + escapeHtml(q.name) + '</h3><p>' + escapeHtml(q.acceptedAnswer.text) + '</p></div>';
  });

  let jsonLdScripts = '';
  jsonLd.forEach(function(obj) {
    jsonLdScripts += '<script type="application/ld+json">' + JSON.stringify(obj, null, 2) + '</' + 'script>\n';
  });

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + titleE + ' | President Tire &amp; Wheels</title>\n'
    + '<meta name="description" content="' + brandE + ' ' + modelE + ' tire in ' + size + ' ' + tire.specs.loadIndex + tire.specs.speedRating + ', $' + priceStr + '. In stock at President Tire &amp; Wheels, Waterloo, ON. Call (226) 698-1667.">\n'
    + '<link rel="canonical" href="' + url + '">\n'
    + jsonLdScripts
    + '<style>\n'
    + '  *{box-sizing:border-box}\n'
    + '  body{background:#000;color:#fff;font-family:Arial,Helvetica,sans-serif;margin:0;padding:0}\n'
    + '  .wrap{max-width:1000px;margin:0 auto;padding:32px 18px 96px}\n'
    + '  .crumb{font-size:13px;color:#9aa39d;margin-bottom:20px}\n'
    + '  .crumb a{color:#9aa39d;text-decoration:none}\n'
    + '  .crumb a:hover{color:#03ff7f}\n'
    + '  .grid{display:grid;grid-template-columns:340px 1fr;gap:32px;margin-bottom:24px}\n'
    + '  @media(max-width:700px){.grid{grid-template-columns:1fr}}\n'
    + '  .imgbox{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:18px;padding:24px;display:flex;align-items:center;justify-content:center;height:280px}\n'
    + '  .imgbox img{max-width:100%;max-height:100%}\n'
    + '  .brand{color:#8d8d8d;font-size:13px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}\n'
    + '  h1{font-size:26px;line-height:1.2;margin:0 0 14px 0}\n'
    + '  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}\n'
    + '  .badge{background:#0d0d0d;border:1px solid #1f1f1f;color:#d0d8d4;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700}\n'
    + '  .price{font-size:34px;font-weight:800;color:#03ff7f;margin-bottom:2px}\n'
    + '  .msrp{color:#8d8d8d;text-decoration:line-through;font-size:16px;margin-right:8px}\n'
    + '  .stock{color:#03ff7f;font-size:13px;font-weight:700;margin-bottom:16px}\n'
    + '  .lowstock{color:#ffb020}\n'
    + '  .cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}\n'
    + '  .btn{display:inline-block;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:15px;font-weight:800}\n'
    + '  .btn-primary{background:#03ff7f;color:#000}\n'
    + '  .btn-secondary{background:#111;color:#fff;border:1px solid #262626}\n'
    + '  .trustrow{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0;padding:18px 0;border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a}\n'
    + '  @media(max-width:700px){.trustrow{grid-template-columns:repeat(2,1fr)}}\n'
    + '  .trustitem{text-align:center;font-size:12px;color:#9aa39d}\n'
    + '  .trustitem strong{display:block;color:#fff;font-size:13px;margin-bottom:2px}\n'
    + '  .section{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:18px;padding:24px;margin-bottom:20px}\n'
    + '  .section h2{font-size:18px;margin:0 0 14px 0;color:#fff}\n'
    + '  table{width:100%;border-collapse:collapse}\n'
    + '  td{padding:10px 0;border-top:1px solid #1e1e1e;font-size:14px}\n'
    + '  td:first-child{color:#8d8d8d;width:45%}\n'
    + '  td:last-child{color:#fff;font-weight:600}\n'
    + '  .faqq{padding:14px 0;border-top:1px solid #1e1e1e}\n'
    + '  .faqq h3{margin:0 0 6px 0;font-size:14px;color:#03ff7f}\n'
    + '  .faqq p{margin:0;color:#c9d0cb;font-size:14px;line-height:1.6}\n'
    + '  .footer{text-align:center;color:#7a8580;font-size:13px;margin-top:20px}\n'
    + '  .footer a{color:#9aa39d;text-decoration:none}\n'
    + '  .stickybar{position:fixed;bottom:0;left:0;right:0;background:#0a0a0a;border-top:1px solid #1e1e1e;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:50}\n'
    + '  .stickybar .p{color:#03ff7f;font-weight:800;font-size:15px}\n'
    + '  .stickybar a{background:#03ff7f;color:#000;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:800;font-size:14px}\n'
    + '  @media(min-width:701px){.stickybar{display:none}}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="wrap">\n'
    + '  <div class="crumb"><a href="' + SITE_BASE + '/">Live Search</a> &rsaquo; <a href="' + sizeHubUrl(size) + '">' + size + ' Tires</a> &rsaquo; ' + brandE + ' ' + modelE + '</div>\n'
    + '  <div class="grid">\n'
    + '    <div class="imgbox"><img src="' + imageE + '" alt="' + brandE + ' ' + modelE + ' tire" loading="lazy"></div>\n'
    + '    <div>\n'
    + '      <div class="brand">' + brandE + '</div>\n'
    + '      <h1>' + modelE + ' &mdash; ' + size + ' ' + tire.specs.loadIndex + tire.specs.speedRating + '</h1>\n'
    + '      ' + sizePicker + '\n'
    + '      <div class="badges">\n'
    + '        <span class="badge">' + seasonE + '</span>\n'
    + (tire.specs.warrantyMileage ? ('        <span class="badge">' + Number(tire.specs.warrantyMileage).toLocaleString() + ' km Warranty</span>\n') : '')
    + '        <span class="badge">Load Index ' + tire.specs.loadIndex + '</span>\n'
    + '        <span class="badge">Speed Rating ' + tire.specs.speedRating + '</span>\n'
    + '      </div>\n'
    + '      <div>' + (msrpStr ? ('<span class="msrp">$' + msrpStr + '</span>') : '') + '<span class="price">$' + priceStr + '</span></div>\n'
    + '      <div class="stock ' + (lowStock ? 'lowstock' : '') + '">' + (tire.inStock ? (lowStock ? ('&#9888; Only ' + tire.totalStock + ' left at this price &mdash; call to reserve') : ('&#10003; In stock &mdash; ' + tire.totalStock + ' available, next-day to Waterloo')) : 'Currently out of stock &mdash; call to check alternatives') + '</div>\n'
    + '      <div class="cta">\n'
    + '        <a class="btn btn-primary" href="tel:+12266981667">Call (226) 698-1667</a>\n'
    + '        <a class="btn btn-secondary" href="https://presidentwheels.ca/contact-us">Request a Quote</a>\n'
    + '      </div>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="trustrow">\n'
    + '    <div class="trustitem"><strong>Pro install available</strong>Balanced &amp; inspected</div>\n'
    + '    <div class="trustitem"><strong>' + (tire.specs.warrantyMileage ? (Number(tire.specs.warrantyMileage).toLocaleString() + ' km') : 'Manufacturer') + '</strong>Tread warranty</div>\n'
    + '    <div class="trustitem"><strong>Next-day</strong>Warehouse delivery</div>\n'
    + '    <div class="trustitem"><strong>4.9 &#9733; Google</strong>160+ reviews</div>\n'
    + '  </div>\n'
    + '  <div class="section">\n'
    + '    <h2>Specifications</h2>\n'
    + '    <table>\n'
    + '      <tr><td>Size</td><td>' + size + '</td></tr>\n'
    + '      <tr><td>Load Index / Speed Rating</td><td>' + tire.specs.loadIndex + tire.specs.speedRating + '</td></tr>\n'
    + '      <tr><td>Season</td><td>' + seasonE + '</td></tr>\n'
    + (tire.specs.warrantyMileage ? ('      <tr><td>Tread Warranty</td><td>' + Number(tire.specs.warrantyMileage).toLocaleString() + ' km</td></tr>\n') : '')
    + '      <tr><td>Run Flat</td><td>' + escapeHtml(tire.specs.runFlat) + '</td></tr>\n'
    + '      <tr><td>EV Optimized</td><td>' + escapeHtml(tire.specs.evOptimized) + '</td></tr>\n'
    + '      <tr><td>Item Number</td><td>' + escapeHtml(tire.itemNumber) + '</td></tr>\n'
    + '    </table>\n'
    + '  </div>\n'
    + '  ' + altSection + '\n'
    + '  <div class="section">\n'
    + '    <h2>Common Questions</h2>\n'
    + '    ' + faqHtml + '\n'
    + '  </div>\n'
    + '  <div class="footer">\n'
    + '    <a href="' + SITE_BASE + '/">&larr; Back to Live Search</a> &middot;\n'
    + '    <a href="' + sizeHubUrl(size) + '">' + size + ' Tires</a> &middot;\n'
    + '    <a href="https://presidentwheels.ca/contact-us">Contact Us</a>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="stickybar">\n'
    + '  <span class="p">$' + priceStr + '</span>\n'
    + '  <a href="tel:+12266981667">Call to buy</a>\n'
    + '</div>\n'
    + '</body>\n</html>\n';
}

async function main() {
  const bySize = {};
  const productSizes = {};

  for (const size of SIZES) {
    const res = await fetch(API_BASE + '?size=' + encodeURIComponent(size));
    const data = await res.json();
    if (!data.ok) {
      console.warn('Skipping ' + size + ': API error');
      continue;
    }
    const tires = (data.results || []).filter(function(t){ return t.inStock; });
    bySize[size] = tires;

    for (const tire of tires) {
      const built = productUrl(tire, size);
      if (!productSizes[built.productSlug]) productSizes[built.productSlug] = [];
      productSizes[built.productSlug].push({ size: size, url: built.url, id: tire.id });
    }
    console.log('Fetched ' + size + ': ' + tires.length + ' in-stock products');
  }

  const sitemapUrls = [];
  let created = 0;

  for (const size of SIZES) {
    const tires = bySize[size] || [];
    for (const tire of tires) {
      const built = productUrl(tire, size);

      const siblingSizes = (productSizes[built.productSlug] || [])
        .filter(function(s){ return s.id !== tire.id; })
        .sort(function(a, b){ return a.size.localeCompare(b.size); });

      const alternatives = tires
        .filter(function(t){ return t.id !== tire.id; })
        .sort(function(a, b){ return Math.abs(a.price - tire.price) - Math.abs(b.price - tire.price); })
        .slice(0, 3);

      const dirPath = path.join(OUT_DIR, built.path);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'index.html'), renderPage(tire, size, siblingSizes, alternatives));
      sitemapUrls.push(built.url);
      created++;
    }
  }

  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  sitemapUrls.forEach(function(u) {
    sitemap += '  <url><loc>' + u + '</loc></url>\n';
  });
  sitemap += '</urlset>\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap-products.xml'), sitemap);

  console.log('\nDone. ' + created + ' product pages written to ' + OUT_DIR);
  console.log('Next steps:');
  console.log('1. Copy the contents of ./dist into your tires-catalog repo root');
  console.log('2. git add -A && git commit -m "Add per-product pages" && git push');
  console.log('3. GitHub Pages will serve them automatically at tires.presidentwheels.ca/{product}/{size}/');
}


module.exports = { renderPage, productUrl, sizeHubUrl, slugify };
if (require.main === module) {
  main();
}
