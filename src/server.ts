import { Browser } from "puppeteer";

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import express from "express";
const app = express();
import ejs from "ejs";
import cors from "cors";
import morgan from "morgan";
import { padWithZero } from "./utils";
import { evaluate } from 'mathjs';
import { inspect } from 'util';
import { DateTime } from 'luxon'

app.use(express.json());
app.use(cors());
app.use(morgan("combined"));

export default function createServer(): Promise<any> {
    return new Promise((resolve, _) => {
        puppeteer
            .launch({
                args: ["--no-sandbox"],
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
                            console.debug(inspect(args, {showHidden: false, depth: null, colors: true}))
                            const render = (await ejs.renderFile(
                                templatePath,
                                {...args, math: {
                                    evaluate
                                }, DateTime}
                            )) as string;
                            if (outputType === "pdf") {
                                res.setHeader(
                                    "Content-Type",
                                    "application/pdf"
                                );

                                const watermarkExceptions = ["diario-classe", "tabela"]

                                const page = await browser.newPage();
                                await page.setContent(render);
                                await page.evaluateHandle(
                                    "document.fonts.ready"
                                );
                                const dateNow = DateTime.now().setZone("America/Sao_Paulo")
                                const stream = await page.createPDFStream({
                                    format: "a4",
                                    margin: {
                                        top: 15,
                                        bottom: 30,
                                        left: 10,
                                        right: 10,
                                    },
                                    footerTemplate: `
                                <div style="width: 100%; margin-right: 10px; text-align: right; font-size: 8px;">
                                     PDF gerado pela a Plataforma InfoEduc na data ${dateNow.toFormat("dd/MM/yyyy")} às ${dateNow.toFormat("HH:mm:ss")}

                                </div>
                                `,
                                    displayHeaderFooter: watermarkExceptions.indexOf(reqTemplate) !== -1 ? false : true,
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
