import { Browser, PaperFormat } from "puppeteer";

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import express, { Request } from "express";
const app = express();
import ejs from "ejs";
import { compile, evaluate } from "mathjs";
import { inspect } from "util";
import { DateTime, Duration } from "luxon";
import logfmt from "logfmt";
import chokidar from "chokidar";

function logFormat(message: object) {
    logfmt.log(message);
}

app.use(express.json({ limit: '10mb' }));

function getIp(req: Request) {
    return (
        req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"] ||
        req.ip ||
        undefined
    );
}

app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"];

    logFormat({
        message: "Incoming request",
        heroku_request_id: requestId,
        template_name: req.body["templateName"],
        method: req.method,
        ua: req.headers["user-agent"],
        ip: getIp(req),
    });
    next();
});

export default function createServer(): Promise<any> {
    const avaliableTemplates = new Map<
        string,
        {
            format: string;
            landscape: boolean;
            noWatermark: boolean;
            path: string;
        }
    >();
    const pathList = JSON.parse(
        fs.readFileSync(path.join(__dirname, "./templates/config.json"), {
            encoding: "utf8",
        })
    ) as Array<{
        path: string;
        format: string;
        landscape: boolean;
        watermark_exceptions: Array<string>;
    }>;

    if (process.env.NODE_ENV === "development") {
        logFormat({
            env: "development",
            message: "Watching for local changes",
        });

        pathList.forEach((config) => {
            const joinedPath = path.join(__dirname, "templates", config.path);

            chokidar
                .watch(joinedPath)
                .on("add", (filepath) => {
                    if (filepath.endsWith(".ejs")) {
                        const templateName = path
                            .basename(filepath)
                            .replace(".ejs", "");

                        if (!avaliableTemplates.has(templateName)) {
                            avaliableTemplates.set(templateName, {
                                format: config.format.toLowerCase(),
                                landscape: config.landscape,
                                noWatermark:
                                    config.watermark_exceptions &&
                                    config.watermark_exceptions.indexOf(
                                        templateName
                                    ) !== -1,
                                path: filepath,
                            });
                        }

                        logFormat({
                            message: "Added new template file",
                            config_path: joinedPath,
                            filepath: filepath,
                        });
                    }
                })
                .on("unlink", (filepath) => {
                    if (filepath.endsWith(".ejs")) {
                        const templateName = path
                            .basename(filepath)
                            .replace(".ejs", "");

                        const hasDeleted =
                            avaliableTemplates.delete(templateName);

                        logFormat({
                            message: "File has been removed",
                            path: filepath,
                            removed_from_map: hasDeleted,
                        });
                    }
                });
        });
    } else {
        logFormat({
            env: "production",
            message: "Mapping template files",
        });

        pathList.forEach((cfg) => {
            const templatesPath = path.join(__dirname, "templates", cfg.path);
            if (fs.existsSync(templatesPath)) {
                const templates = fs.readdirSync(templatesPath);
                templates.forEach((template) => {
                    const joinedPath = path.join(templatesPath, template);
                    const stat = fs.statSync(joinedPath);
                    if (stat.isFile()) {
                        const templateName = path
                            .basename(template)
                            .replace(".ejs", "");

                        avaliableTemplates.set(templateName, {
                            format: cfg.format.toLowerCase(),
                            landscape: cfg.landscape,
                            noWatermark:
                                cfg.watermark_exceptions &&
                                cfg.watermark_exceptions.indexOf(
                                    templateName
                                ) !== -1,
                            path: path.join(templatesPath, template),
                        });
                    }
                });
            }
        });
        logFormat({
            message: "Finished mapping template files",
            map_size: avaliableTemplates.size,
        });
    }

    return new Promise((resolve, _) => {
        puppeteer
            .launch({
                // Necessário para rodar no Heroku
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
                        return res
                            .status(400)
                            .send("Invalid template name (not a string)");

                    if (typeof args !== "object")
                        return res
                            .status(400)
                            .send("No arguments object provided");

                    try {
                        const template = avaliableTemplates.get(reqTemplate);
                        if (template) {
                            console.debug(
                                inspect(args, {
                                    showHidden: false,
                                    depth: null,
                                    colors: true,
                                })
                            );
                            const render = (await ejs.renderFile(
                                template.path,
                                {
                                    ...args,
                                    math: {
                                        compile,
                                        evaluate,
                                    },
                                    DateTime,
                                    Duration,
                                }
                            )) as string;
                            if (outputType === "pdf") {
                                res.setHeader(
                                    "Content-Type",
                                    "application/pdf"
                                );

                                const page = await browser.newPage();
                                page.setJavaScriptEnabled(false);

                                await page.setViewport({
                                    width: 2480,
                                    height: 3508,
                                });
                                await page.setContent(render);
                                await page.evaluateHandle(
                                    "document.fonts.ready"
                                );
                                const dateNow =
                                    DateTime.now().setZone("America/Sao_Paulo");
                                const stream = await page.createPDFStream({
                                    format: template.format as PaperFormat,
                                    landscape: template.landscape,
                                    margin: {
                                        top: 15,
                                        bottom: 30,
                                        left: 10,
                                        right: 10,
                                    },
                                    printBackground: true,
                                    footerTemplate: `
                                <div style="width: 100%; margin-right: 10px; text-align: right; font-size: 8px;">
                                PDF gerado pela Plataforma InfoEduc na data ${dateNow.toFormat(
                                    "dd/MM/yyyy"
                                )} às ${dateNow.toFormat("HH:mm:ss")}
                                </div>
                                `,
                                    displayHeaderFooter: !template.noWatermark,
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
