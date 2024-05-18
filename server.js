const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const csv = require('fast-csv');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
const db = new sqlite3.Database('./database.db');

app.use(express.static(__dirname));


const AMAZON_SEARCH_URL = 'https://www.amazon.in/s?k=';

const urls = [
    "https://subbrang.com/shop/wewriteyourmessage/",
    "https://subbrang.com/shop/ekdinaaphamkomiljayenge/",
    "https://subbrang.com/shop/weareinasameboat/",
    "https://subbrang.com/shop/ourtogetherisforever/",
    "https://subbrang.com/shop/sometimesrightplaceisaperson/",
    "https://subbrang.com/shop/youaremyhappyplace/",
    "https://subbrang.com/shop/youhavecaptutredmyheart/",
    "https://subbrang.com/shop/dil-se-dil-tak/",
    "https://subbrang.com/shop/be-gentle-with-yourself/",
    "https://subbrang.com/shop/picture-perfect-smile/",
    "https://subbrang.com/shop/mini-easel-calendar-2024/",
    "https://subbrang.com/shop/hey-there-you-got-this-fridge-magnet/",
    "https://subbrang.com/shop/heartfelt-dua-fridge-magnet-set/",
    "https://subbrang.com/shop/you-are-awesome/",
    "https://subbrang.com/shop/enjoy-every-moment/",
    "https://subbrang.com/shop/enjoy-the-ride/",
    "https://subbrang.com/shop/prioritize-your-peace/",
    "https://subbrang.com/shop/coffee-addiction/",
    "https://subbrang.com/shop/give-yourself-credit-youve-survived-so-much/",
    "https://subbrang.com/shop/watts-up/",
    "https://subbrang.com/shop/find-the-calm-in-the-chaos/",
    "https://subbrang.com/shop/stay-focused/",
    "https://subbrang.com/shop/smile/",
    "https://subbrang.com/shop/you-are-worthy-of-good-things/"
];


app.get('/scrape', async (req, res) => {
    const source = req.query.source; // Get the selected source (subbrang or amazon)
    const keyword = req.query.keyword; // Get the user input keyword
    
    if (source === 'subbrang') {
        const products = [];
        for (const url of urls) {
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);
    
            const name = $('.product_title.entry-title').text().trim();
            const price = $('.price ins .woocommerce-Price-amount.amount').text().trim().split('₹')[1];
            const category = $('.product_meta .posted_in a').text().trim();
            const description = $('.woocommerce-Tabs-panel--description p').text().trim(); // Modified this line
            const image = $('.woocommerce-product-gallery__image img').attr('src');
    
            console.log("name: ",name);
            console.log("price: ",price);
            console.log("category: ",category);
            console.log("description: ",description);
            console.log("image: ",image);
            // Ensure all properties are present
            if (name && price && category && description && image) {
                products.push({ name, price, category, description, image });
            }
        }
    
        db.serialize(() => {
            db.run('DROP TABLE IF EXISTS products'); // Drop the existing table if it exists
            db.run('CREATE TABLE IF NOT EXISTS products (name TEXT, price TEXT, category TEXT, description TEXT, image TEXT)'); // Create the table with the correct columns
        
            db.run('DELETE FROM products', function(err) {
                if (err) {
                    return console.error(err.message);
                }
                console.log(`Deleted ${this.changes} rows`);
            });
            const stmt = db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?)');
            for (let product of products) {
                stmt.run(product.name, product.price, product.category, product.description, product.image);
            }
            stmt.finalize();
            res.send('Scraping done!');
        });
    }
    else if (source === 'amazon') {
        const browser = await puppeteer.launch();
        try {
            const page = await browser.newPage();
            const amazonUrl = AMAZON_SEARCH_URL + encodeURIComponent(keyword);
            await page.goto(amazonUrl, { waitUntil: 'domcontentloaded' });

            await page.waitForSelector('.sg-col-inner');

            let productLinks = await page.$$eval('.sg-col-inner', (containers) => {
                return containers.map((container) => {
                    const linkElement = container.querySelector('.a-link-normal');
                    return linkElement ? linkElement.href : null;
                }).filter(link => link !== null); // This will remove any null values
            });

            // Remove duplicates by converting the array to a Set and then back to an array
            productLinks = [...new Set(productLinks)];

            const limitedLinks = productLinks.slice(0,10);
            console.log("links: ",limitedLinks);
            
            const products = [];
            // const addedProductNames = new Set();
            // var count=10;
            for (const url of limitedLinks) {
                await page.goto(url, { waitUntil: 'domcontentloaded' });

                const name = await page.$eval('#titleSection #productTitle', (element) => element.textContent.trim());
                const image = await page.$eval('#imgTagWrapperId img', (element) => element.src);
                const description = await page.$eval('#feature-bullets ul', (element) => element.textContent.trim());
                const price = await page.$eval('#twister-plus-price-data-price', (element) => element.value);
                
                
                if (name && price && image && description) {
                    products.push({ name, price, image, description });
                    // addedProductNames.add(name);
                }
                
                // Stop if we've already added 10 unique products
                if (products.length >= 10) {
                    break;
                }
                // count=count-1;
            }
            console.log("products: ",products);
            

            // Save scraped data to the SQLite3 database
            db.serialize(() => {
                db.run('DROP TABLE IF EXISTS products'); // Drop the existing table if it exists
                db.run('CREATE TABLE IF NOT EXISTS products (name TEXT, price TEXT, description TEXT, image TEXT)'); // Create the table with the correct columns
            
                db.run('DELETE FROM products', function(err) {
                    if (err) {
                        return console.error(err.message);
                    }
                    console.log(`Deleted ${this.changes} rows`);
                });
                const stmt = db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)');
                for (let product of products) {
                    stmt.run(product.name, product.price, product.description, product.image);
                }
                stmt.finalize();
                res.send('Scraping done!');
            });

            console.log(`Scraped ${products.length} products`);
            // return productLinks;
        } catch (error) {
            console.error('Error scraping Amazon:', error.message);
            throw error;
        } finally {
            await browser.close();
        }
    }else {
        res.status(400).send('Invalid source selected.');
    }

});

app.get('/download', (req, res) => {
    const filePath = path.join(__dirname, 'products.csv');
    const ws = fs.createWriteStream(filePath);

    db.all('SELECT * FROM products', [], (err, rows) => {
        if (err) {
            throw err;
        }
        csv.write(rows, { headers: true }).pipe(ws).on('finish', function() {
            res.download(filePath, function(err) {
                if (err) {
                    console.error('File download failed:', err);
                } else {
                    console.log('File downloaded at:', filePath);
                }
            });
        });
    });
});
app.listen(5000, () => console.log('Server running on port 5000'));