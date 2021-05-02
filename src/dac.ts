import { Buffer } from "buffer";
import { SkynetClient, MySky, JsonData } from "skynet-js";
import { ChildHandshake, Connection, WindowMessenger } from "post-me";
import {
  ISocialDACResponse, ISocialDAC, IDictionary, IFilePaths, IUserRelations
} from "./types";
import stringify from "canonical-json";

// DAC consts
const DATA_DOMAIN = "social-dac.hns";

const urlParams = new URLSearchParams(window.location.search);
const DEBUG_ENABLED = urlParams.get("debug") === "true";
const DEV_ENABLED = urlParams.get("dev") === "true";


// ContentRecordDAC is a DAC that allows recording user interactions with pieces
// of content. There are two types of interactions which are:
// - content creation
// - content interaction (can be anything)
//
// The DAC will store these interactions across a fanout data structure that
// consists of an index file that points to multiple page files.
export default class SocialDAC implements ISocialDAC {
  protected connection: Promise<Connection>;

  private client: SkynetClient;
  private mySky: MySky;
  private paths: IFilePaths;
  private skapp: string;

  public constructor() {
    // create client
    this.client = new SkynetClient();

    // define API
    const methods = {
      init: this.init.bind(this),
      onUserLogin: this.onUserLogin.bind(this),
      follow: this.follow.bind(this),
      unfollow: this.unfollow.bind(this),
    };

    // create connection
    this.connection = ChildHandshake(
      new WindowMessenger({
        localWindow: window,
        remoteWindow: window.parent,
        remoteOrigin: "*",
      }),
      methods
    );
  }

  public async init() {
    try {
      this.log("[SocialDAC] init");
      // extract the skappname and use it to set the filepaths
      const hostname = new URL(document.referrer).hostname;
      const skapp = await this.client.extractDomain(hostname);
      this.log("loaded from skapp", skapp);
      this.skapp = skapp;

      this.paths = {
        SKAPPS_DICT_PATH: `${DATA_DOMAIN}/skapps.json`,
        FOLLOWING_MAP_PATH: `${DATA_DOMAIN}/${skapp}/following.json`,
      };


      this.log("[SocialDAC] loaded paths");

      // load mysky
      const opts = { dev: DEV_ENABLED };
      this.mySky = await this.client.loadMySky(DATA_DOMAIN, opts);

      this.log("[SocialDAC] loaded MySky");
    } catch (error) {
      this.log("Failed to load MySky, err: ", error);
      throw error;
    }
  }

  // onUserLogin is called by MySky when the user has logged in successfully
  public async onUserLogin() {
    // Register the skapp name in the dictionary
    this.registerSkappName()
      .then(() => {
        this.log("Successfully registered skappname");
      })
      .catch((err) => {
        this.log("Failed to register skappname, err: ", err);
      });
  }

  public async follow(userId: string): Promise<ISocialDACResponse> {
    try {

      let userRelations = await this.fetchUserRelationsMap<IUserRelations>();

      userRelations.relations[userId] = {
        ts: Date.now(),
      };

      await this.updateFile(this.paths.FOLLOWING_MAP_PATH, userRelations);

      return {
        success: true,
      };
    } catch (error) {
      console.trace(error);
      console.log((error as Error).stack);
      this.log("createPost: Error occurred, err: ", error);
      return {
        success: false,
        error: stringify(error),
      };
    }
  }

  public async unfollow(userId: string): Promise<ISocialDACResponse> {
    try {

      let userRelations = await this.fetchUserRelationsMap<IUserRelations>();

      if (!(userId in userRelations.relations)) {
        return {
          success: false,
          error: `Not following user with this skapp. (skapp: ${this.skapp}, userId: ${userId})`
        };
      }
      ;
      delete userRelations.relations[userId];

      await this.updateFile(this.paths.FOLLOWING_MAP_PATH, userRelations);

      return {
        success: true,
      };
    } catch (error) {
      console.trace(error);
      console.log((error as Error).stack);
      this.log("createPost: Error occurred, err: ", error);
      return {
        success: false,
        error: stringify(error),
      };
    }
  }


  // registerSkappName is called on init and ensures this skapp name is
  // registered in the skapp name dictionary.
  private async registerSkappName() {
    const { SKAPPS_DICT_PATH } = this.paths;
    let skapps = await this.downloadFile<IDictionary>(SKAPPS_DICT_PATH);
    if (!skapps) {
      skapps = {};
    }
    skapps[this.skapp] = true;
    await this.updateFile(SKAPPS_DICT_PATH, skapps);
  }



  // fetchPage downloads the current page for given index, if the page does not
  // exist yet it will return the default page.
  private async fetchUserRelationsMap<T>(): Promise<IUserRelations> {
    /* const indexPath = kind === EntryType.POST ? this.paths.POSTS_INDEX_PATH : this.paths.COMMENTS_INDEX_PATH;

    const pagePath = kind === EntryType.POST ? this.paths.POSTS_PAGE_PATH : this.paths.COMMENTS_PAGE_PATH;

    const currPageStr = String(index.currPageNumber);
    const currPagePath = pagePath.replace(PAGE_REF, currPageStr); */

    let userRelations = await this.downloadFile<IUserRelations>(this.paths.FOLLOWING_MAP_PATH);
    if (!userRelations) {
      userRelations = {
        $schema: "https://skystandards.hns.siasky.net/draft-01/userRelations.schema.json",
        _self: "sky://ed25519-" + (await this.mySky.userID()) + "/" + this.paths.FOLLOWING_MAP_PATH, // back reference to the path
        relationType: "following",
        relations: {},

      };
    }
    return userRelations;
  }

  // downloadFile merely wraps getJSON but is typed in a way that avoids
  // repeating the awkward "as unknown as T" everywhere
  private async downloadFile<T>(path: string): Promise<T | null> {
    this.log("downloading file at path", path);
    const { data } = await this.mySky.getJSON(path);
    if (!data) {
      this.log("no data found at path", path);
      return null;
    }
    this.log("data found at path", path, data);
    return (data as unknown) as T;
  }

  // updateFile merely wraps setJSON but is typed in a way that avoids repeating
  // the awkwars "as unknown as JsonData" everywhere
  private async updateFile<T>(path: string, data: T) {
    this.log("updating file at path", path, data);
    await this.mySky.setJSON(path, (data as unknown) as JsonData);
  }

  // log prints to stdout only if DEBUG_ENABLED flag is set
  private log(message: string, ...optionalContext: any[]) {
    if (DEBUG_ENABLED) {
      console.log(message, ...optionalContext);
    }
  }
}
