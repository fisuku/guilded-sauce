import {Client} from "@guildedjs/guilded.js"
import Message from "@guildedjs/guilded.js/types/structures/Message";
import {HandlerResult} from "./handlers/handler";
import RestManager from "@guildedjs/guildedjs-rest";
import DMChannel from "@guildedjs/guilded.js/types/structures/channels/DMChannel";
import PartialChannel from "@guildedjs/guilded.js/types/structures/channels/PartialChannel";
import TextChannel from "@guildedjs/guilded.js/types/structures/channels/TextChannel";


interface UploadResponse {
    url: string;
}

interface Media {
    id?: number; // returned on created media object
    channelId?: string; // returned on created object
    additionalInfo: object; // ?
    description: string; // description
    src: string; // uploaded file url
    tags: string[]; // idk yet
    teamId?: string; // not needed when posting
    title: string; // title
    type: string; // "image"
}

interface MediaReply {
    teamId?: string;
    message: object; // message blob
    contentId: number; // the media ID
    id: number; // random?
    postId: number; // also the media ID?
}

const options = require('./config.json');
const guilded = new Client();

const handlers = options.handlers.map(handler => {
    const exp = require(`./handlers/${handler}`);
    const h = new exp.default(options[handler] || {});
    console.log(`Loaded handler '${h.id}'`);
    return h;
});

guilded.on('ready', () => console.log(`Bot is successfully logged in`));

guilded.on("messageCreate", async message => {
    const targetChannel = message.parsedContent.mentions.channels[0];
    if (!targetChannel) return;

    try {
        await postMediaThread(targetChannel, await resolveHandler(message));
    } catch (e) {
        if (e.message) {
            console.log(`bail: ${e.message}`);
            await message.channel.send(`❌ ${e.message}`).catch(r => {
                console.log(r);
            });
        }
    }
})

async function postMediaThread(channel: string, result: HandlerResult) {
    const attachments: UploadResponse | Record<string, any>[] = [];
    const errors = [];

    for (const url of result.media) {
        try {
            attachments.push(await uploadFromUrl(url));
        } catch (e) {
            errors.push(e);
        }
    }

    if (errors.length > 0) {
        console.log(`${errors.length} errors encountered; logging.`)
        errors.forEach(e => console.log(e));
    }

    if (attachments.length == 0) {
        console.log("no media to upload, stop");
        return;
    }

    try {
        const resp = await media(channel, {
            additionalInfo: {},
            description: result.description,
            src: attachments[0].url,
            tags: result.tags,
            title: result.title.substr(0, 80),
            type: "image"
        });

        if (attachments.length > 1) {
            await mediaReply(resp, {
                document: {
                    object: "document",
                    data: {},
                    nodes: attachments.splice(1).map((result: UploadResponse) => imageUrlToCaptionedNode(result.url))
                },
                object: "value"
            });
        }
    } catch (e) {
        console.log(e)
    }
}

function uploadFromUrl(url: string): Promise<UploadResponse | Record<string, any>> {
    return getMediaManager().post('/media/upload', {
        dynamicMediaTypeId: "ContentMedia",
        mediaInfo: {
            src: url
        },
        uploadTrackingId: "r-0000000-0000000" // don't care about this
    });
}

function media(channelId: string, media: Media): Promise<Media> {
    return guilded.rest.post(`/channels/${channelId}/media`, media) as Promise<Media>;
}

function mediaReply(media: Media, message: object): Promise<MediaReply> {
    const doc = {
        channelId: media.channelId,
        contentId: media.id,
        contentType: "team_media",
        gameId: null,
        id: Math.floor(Math.random() * 2 ** 28), // afaik this is completely random and matters not at all
        isContentReply: true,
        message: message,
        postId: media.id,
        teamId: media.teamId
    };

    return guilded.rest.post(`/content/team_media/${media.id}/replies`, doc) as Promise<MediaReply>;
}

/**
 * grab message urls
 * @param message
 */
function parseUrls(message: Message): string[] {
    const out = [];

    (message.raw.content.document.nodes as Object[]).filter((node: any) => node.type === 'paragraph').forEach((node: any) => {
        out.push(...node.nodes.filter(leaf => leaf.type === "link").map(leaf => leaf.data.href));
    });

    return out;
}

async function resolveHandler(message: Message): Promise<HandlerResult> {
    const url = parseUrls(message)[0];
    if (!url) return Promise.reject();

    console.log(`intercepted URL ${url}'`);

    // cycle through our handlers, raise any non-empty promises into errors and break out.
    // this is designed this way so we can fall back to a backup handler, if it's ever needed
    for (const handler of handlers) {
        console.log(`trying handler '${handler.id}'`);

        const result = await handler.handle(url).catch(e => {
            if (e !== undefined) throw e;
        });

        if (result) return result;
    }

    console.log("no handlers discovered for this URL.");
    // we'd usually say something like "This url is not supported" but that might be annoying
    throw new Error();
}

function getMediaManager(): RestManager {
    const manager = new RestManager({
        "apiURL": 'https://media.guilded.gg'
    });
    manager.cookieJar = guilded.rest.cookieJar;
    manager.token = guilded.rest.token;
    return manager;
}

function imageUrlToCaptionedNode(url: string, caption: string = ""): object {
    return {
        object: "block",
        type: "image",
        data: {
            src: url,
        },
        nodes: [{
            object: "block",
            type: "image-caption-line",
            data: {},
            nodes: [{
                object: "text",
                leaves: [
                    {
                        object: "leaf",
                        text: caption,
                        marks: []
                    }
                ]
            }]
        }]
    }
}

guilded.login(options.guilded);