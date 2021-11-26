import { Browser } from "puppeteer";

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import express from "express";
const app = express();
import ejs from "ejs";
import cors from "cors";
import morgan from "morgan";

app.use(express.json());
app.use(cors());
app.use(morgan("combined"));

export default function createServer(): Promise<any> {
    return new Promise((resolve, _) => {
        puppeteer
            .launch({
                args: ["--no-sandbox"]
            })
            .then((browser: Browser) => {
                app.post("/generate", async (req, res, next) => {
                    const reqTemplate = req.body.templateName;
                    const args = req.body.arguments;

                    const outputType = req.body.output
                        ? req.body.output
                        : "pdf";
                    if (typeof reqTemplate !== "string")
                        return res.status(400).send("Invalid template name");
                    if (typeof args !== "object")
                        return res
                            .status(400)
                            .send("No arguments object provided");

                    const filename = reqTemplate + ".ejs";
                    const templatePath = path.join(
                        __dirname,
                        "ejs-templates",
                        filename
                    );

                    try {
                        if (fs.existsSync(templatePath)) {
                            const render = (await ejs.renderFile(
                                templatePath,
                                args
                            )) as string;
                            if (outputType === "pdf") {
                                res.setHeader(
                                    "Content-Type",
                                    "application/pdf"
                                );
                                const page = await browser.newPage();
                                await page.setContent(render);
                                await page.evaluateHandle(
                                    "document.fonts.ready"
                                );
                                const stream = await page.createPDFStream({
                                    format: "a4",
                                    margin: {
                                        top: 15,
                                        bottom: 20,
                                        left: 10,
                                        right: 10,
                                    },
                                    footerTemplate: `
                                <div style="width: 100%; margin-right: 10px; text-align: right; font-size: 8px;">
                                     PDF gerado pela a Plataforma InfoEduc
                                </div>
                                `,
                                    displayHeaderFooter: true,
                                });
                                stream.pipe(res);
                                stream.on("end", async () => {
                                    await page.close();
                                });
                            } else if (outputType === "html") {
                                res.send(render);
                            } else {
                                res.status(400).send("Invalid output type");
                            }
                        } else {
                            res.status(404).send("No template found");
                        }
                    } catch (e: any) {
                        next(e);
                    }
                });
            })
            .then(() => resolve(app));
    });
}
