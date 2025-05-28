(function () {
	'use strict';

	const hostAddress = 'http://smotret24.ru/';
	const providersList = [
		'alloha', 'anilibria', 'animebesst',
		'animedia', 'animego', 'animelib',
		'animevost', 'ashdi', 'autoembed',
		'cdnmovies', 'cdnvideohub', 'collaps',
		'collaps-dash', 'fancdn', 'filmix',
		'filmixtv', 'fxapi', 'hdvb',
		'hydraflix', 'iframevideo', 'kinopub',
		'kinotochka', 'kinoukr', 'kodik',
		'lumex', 'lumex', 'mirage',
		'moonanime', 'movpi', 'pidtor',
		'rc/filmix', 'rc/fxapi', 'rc/rhs',
		'redheadsound', 'remux', 'rezka',
		'rgshows', 'rhsprem', 'smashystream',
		'vcdn', 'vdbmovies', 'vibix',
		'videasy', 'videocdn', 'videodb',
		'videoseed', 'vidlink', 'vidsrc',
		'vokino', 'zetflix'
	];

	if (!window.rch) {
		Lampa.Utils.putScript(['https://qlampa.github.io/plugins/invc-rch.js'], () => { }, null, () => {
			if (!window.rch.startTypeInvoke)
				window.rch.typeInvoke('http://smotret24.ru', () => { });
		}, true);
	}

	var hubConnection;
	var hubTimer;
	function rchInvoke(json, call) {
		if (hubConnection) {
			clearTimeout(hubTimer);
			hubConnection.stop();
			hubConnection = null;
		}

		hubConnection = new signalR.HubConnectionBuilder().withUrl(json.ws).build();
		hubConnection.start().then(() => {
			window.rch.Registry(json.result, hubConnection, call);
		}).catch((err) => {
			Lampa.Noty.show(err.toString());
		});

		if (json.keepalive > 0) {
			hubTimer = setTimeout(() => {
				hubConnection.stop();
				hubConnection = null;
			}, 1000 * json.keepalive);
		}
	}

	function rchRun(json, call) {
		if (signalR === undefined)
			Lampa.Utils.putScript(['https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/6.0.25/signalr.js'], () => { }, null, () => {
				rchInvoke(json, call);
			}, true);
		else
			rchInvoke(json, call);
	}

	function addAccountParams(url) {
		if (url.indexOf('account_email=') == -1) {
			let email = Lampa.Storage.get('account_email');
			if (email)
				url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
		}

		if (url.indexOf('uid=') == -1) {
			let uid = Lampa.Storage.get('lampac_unic_id', '');
			if (!uid) {
				uid = Lampa.Utils.uid(8).toLowerCase();
				Lampa.Storage.set('lampac_unic_id', uid);
			}
			if (uid)
				url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
		}

		return url;
	}

	function clarificationSearchAdd(id, value) {
		let clarificationList = Lampa.Storage.get('qwatch_clarification_search', '{}');
		clarificationList[id] = value;
		Lampa.Storage.set('qwatch_clarification_search', clarificationList);
	}

	function clarificationSearchDelete(id) {
		let clarificationList = Lampa.Storage.get('qwatch_clarification_search', '{}');
		delete clarificationList[id];
		Lampa.Storage.set('qwatch_clarification_search', clarificationList);
	}

	function clarificationSearchGet(id) {
		let clarificationList = Lampa.Storage.get('qwatch_clarification_search', '{}');
		return clarificationList[id];
	}

	/**
	 * plugin component
	 * @class
	 * @param {Object} object 
	 **/
	function QWatchComponent(object) {
		let network = new Lampa.Reguest();
		let scroll = new Lampa.Scroll({
			mask: true,
			over: true
		});
		// @test: theres Lampa.Component.Episodes that already does much of what we're doing manually
		let explorer = new Lampa.Explorer(object);
		let filter = new Lampa.Filter(object);
		let lastFocusTarget;

		/**
		 * @typedef SourceData
		 * @type {{url:string,name:string,show:boolean}}
		 **/
		/**
		 * container of the available (alive) providers
		 * @type {Object.<string, SourceData>}
		 **/
		let providersAlive = {};
		/**
		 * current provider used for search
		 * @type {Object}
		 **/
		let providerActive;
		/**
		 * current provider search URL
		 * @type {string}
		 **/
		let providerActiveUrl;
		/**
		 * provider used last time
		 * @type {Object}
		 **/
		let providersLast = Lampa.Storage.cache('online_last_balanser', 200, {});
		if (providersLast)
			providerActive = providersLast[object.movie.id];
		let providerTimer;

		let images = [];
		let number_of_requests = 0;
		let number_of_requests_timer;
		let life_wait_times = 0;
		let life_wait_timer;

		// translations used for titles of the filter fields
		let filterTranslation = {
			season: Lampa.Lang.translate('torrent_serial_season'),
			voice: Lampa.Lang.translate('torrent_parser_voice'),
			source: Lampa.Lang.translate('settings_rest_source')
		};
		// list of the available sources to filter
		let filterSources = [];
		// container of the filtered objects
		let filterFound = {
			season: [],
			voice: []
		};

		function getProviderName(entryJson) {
			return (entryJson["balanser"] || entryJson["name"].split(' ')[0]).toLowerCase();
		}

		this.rch = function (json, noReset) {
			rchRun(json, () => {
				if (!noReset)
					this.find();
				else
					noReset();
			});
		};
		this.requestExternalIds = function () {
			return new Promise((resolve, reject) => {
				if (!object.movie.imdb_id || !object.movie.kinopoisk_id) {
					let query = [];
					query.push('id=' + object.movie.id);
					query.push('serial=' + (object.movie.name ? 1 : 0));
					if (object.movie.imdb_id)
						query.push('imdb_id=' + object.movie.imdb_id);
					if (object.movie.kinopoisk_id)
						query.push('kinopoisk_id=' + object.movie.kinopoisk_id);

					network.timeout(10_000);
					network.silent(hostAddress + 'externalids?' + query.join('&'), (externalIds) => {
						for (const id in externalIds)
							object.movie[id] = externalIds[id];

						resolve();
					}, resolve);
				}
				else
					resolve();
			});
		};
		this.updateProvider = function (providerName) {
			providersLast[object.movie.id] = providerName;
			Lampa.Storage.set('online_last_balanser', providersLast);
		};
		this.changeProvider = function (providerName) {
			this.updateProvider(providerName);
			Lampa.Storage.set('online_balanser', providerName);
			let newChoice = this.getChoice(providerName);
			let lastChoice = this.getChoice();
			if (lastChoice.voice_name)
				newChoice.voice_name = lastChoice.voice_name;
			this.saveChoice(newChoice, providerName);
			Lampa.Activity.replace();
		};
		this.addLampacParams = function (url) {
			let query = [];

			query.push('id=' + object.movie.id);
			if (object.movie.imdb_id)
				query.push('imdb_id=' + object.movie.imdb_id);
			if (object.movie.kinopoisk_id)
				query.push('kinopoisk_id=' + object.movie.kinopoisk_id);
			query.push('title=' + encodeURIComponent(object.clarification ? object.search : object.movie.title || object.movie.name));
			query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name));
			query.push('serial=' + (object.movie.name ? 1 : 0));
			query.push('original_language=' + (object.movie.original_language || ''));
			query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
			query.push('source=' + (object.movie.source || 'tmdb'));
			query.push('clarification=' + (object.clarification ? 1 : 0));
			const accountEmail = Lampa.Storage.get('account_email', '');
			if (accountEmail.length > 0)
				query.push('cub_id=' + Lampa.Utils.hash(accountEmail));
			query.push('rchtype=' + (window.rch ? window.rch.type : ''));
			query.push('similar=' + (object.similar ? true : false));

			return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
		};
		this.getLastChoiceProvider = function () {
			if (providersLast[object.movie.id])
				return providersLast[object.movie.id];
			else
				return Lampa.Storage.get('online_balanser', filterSources.length > 0 ? filterSources[0] : '');
		};
		this.startSource = function (sourcesJson) {
			return new Promise((resolve, reject) => {
				for (const source of sourcesJson) {
					const sourceName = getProviderName(source);
					providersAlive[sourceName] = {
						url: source.url,
						name: source.name,
						show: source.show === undefined ? true : source.show
					};
				};

				filterSources = Lampa.Arrays.getKeys(providersAlive);
				if (filterSources.length > 0) {
					if (providersLast[object.movie.id])
						providerActive = providersLast[object.movie.id];
					else
						providerActive = Lampa.Storage.get('online_balanser', filterSources[0]);

					if (!providersAlive[providerActive] || (!providersAlive[providerActive].show && !object.lampac_custom_select))
						providerActive = filterSources[0];

					providerActiveUrl = providersAlive[providerActive].url;
					resolve(sourcesJson);
				}
				else
					reject();
			});
		};
		this.lifeSource = function () {
			return new Promise((resolve, reject) => {
				let url = this.addLampacParams(hostAddress + 'lifeevents?memkey=' + (this.memkey || ''));
				let red = false;
				let gou = (targetJson, any) => {
					if (targetJson["accsdb"])
						return reject(targetJson);

					let lastProvider = this.getLastChoiceProvider();
					if (!red) {
						let _filter = targetJson.online.filter((c) => {
							return (any ? c.show : (c.show && c.name.toLowerCase() == lastProvider));
						});

						if (_filter.length) {
							red = true;
							resolve(targetJson.online.filter((c) => {
								return c.show;
							}));
						}
						else if (any)
							reject();
					}
				};

				network.timeout(3000);
				network.silent(url, (lifeSourcesJson) => {
					life_wait_times++;
					filterSources = [];
					providersAlive = {};
					lifeSourcesJson.online.forEach((entry) => {
						const providerName = getProviderName(entry);
						providersAlive[providerName] = {
							url: entry.url,
							name: entry.name,
							show: entry.show === undefined ? true : entry.show
						};
					});
					filterSources = Lampa.Arrays.getKeys(providersAlive);
					filter.set('sort', filterSources.map((e) => {
						return {
							title: providersAlive[e].name,
							source: e,
							selected: e == providerActive,
							ghost: !providersAlive[e].show
						};
					}));
					filter.chosen('sort', [providersAlive[providerActive] ? providersAlive[providerActive].name : providerActive]);
					gou(lifeSourcesJson);
					let lastProvider = this.getLastChoiceProvider();
					if (life_wait_times > 15 || lifeSourcesJson.ready) {
						filter.render().find('.qwatch-provider-loader').remove();
						gou(lifeSourcesJson, true);
					}
					else if (!red && providersAlive[lastProvider] && providersAlive[lastProvider].show) {
						gou(lifeSourcesJson, true);
						life_wait_timer = setTimeout(fin, 1000);
					}
					else
						life_wait_timer = setTimeout(fin, 1000);
				}, () => {
					life_wait_times++;
					if (life_wait_times > 15)
						reject();
					else
						life_wait_timer = setTimeout(fin, 1000);
				});
			});
		};
		this.createSource = function () {
			return new Promise((resolve, reject) => {
				network.timeout(15_000);
				network.silent(this.addLampacParams(hostAddress + 'lite/events?life=true'), (targetJson) => {
					if (targetJson["accsdb"])
						return reject(targetJson);

					if (targetJson.life) {
						this.memkey = targetJson.memkey;
						if (targetJson.title) {
							if (object.movie.name)
								object.movie.name = targetJson.title;
							if (object.movie.title)
								object.movie.title = targetJson.title;
						}
						filter.render().find('.filter--sort').append('<span class="qwatch-provider-loader" style="width: 1.2em; height: 1.2em; margin-top: 0; background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain; margin-left: 0.5em"></span>');
						this.lifeSource().then(this.startSource).then(resolve).catch(reject);
					}
					else
						this.startSource(targetJson).then(resolve).catch(reject);
				}, reject);
			});
		};
		/**
		 * activity creation callback
		 **/
		this.create = function () {
			this.setLoading(true);

			filter.onSearch = (value) => {
				clarificationSearchAdd(object.movie.id, value);

				Lampa.Activity.replace({
					search: value,
					clarification: true,
					similar: true
				});
			};
			filter.onBack = () => {
				this.start();
			};

			filter.render().find('.selector').on('hover:enter', () => { clearInterval(providerTimer); });
			filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));

			filter.onSelect = (type, a, b) => {
				if (type == 'filter') {
					if (a.reset) {
						clarificationSearchDelete(object.movie.id);

						this.replaceChoice({
							season: 0,
							voice: 0,
							voice_url: '',
							voice_name: ''
						});
						setTimeout(() => {
							Lampa.Select.close();
							Lampa.Activity.replace({
								clarification: false,
								similar: false
							});
						}, 10);
					}
					else {
						let url = filterFound[a.stype][b.index].url;
						let choice = this.getChoice();
						if (a.stype == 'voice') {
							choice.voice_name = filterFound.voice[b.index].title;
							choice.voice_url = url;
						}
						choice[a.stype] = b.index;
						this.saveChoice(choice);
						this.resetPage();
						this.request(url);
						setTimeout(Lampa.Select.close, 10);
					}
				}
				else if (type == 'sort') {
					Lampa.Select.close();
					object.lampac_custom_select = a.source;
					this.changeProvider(a.source);
				}
			};
			if (filter.addButtonBack)
				filter.addButtonBack();
			filter.render().find('.filter--sort span').text(Lampa.Lang.translate('settings_rest_source'));
			scroll.body().addClass('torrent-list');

			explorer.appendHead(filter.render());
			explorer.appendFiles(scroll.render());
			scroll.minus(explorer.render().find('.explorer__files-head'));
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));

			Lampa.Controller.enable('content');
			this.setLoading(false);

			if (object.provider) {
				explorer.render().find('.filter--search').remove();
				providersAlive = {};
				providersAlive[object.provider] = { name: object.provider };
				providerActive = object.provider;
				filterSources = [];

				return network.native(object.url, this.parseVideosData.bind(this), () => {
					explorer.render().find('.torrent-filter').remove();
					this.showEmptyPage();
				}, false, {
					dataType: 'text'
				});
			}

			this.requestExternalIds().then(() => {
				return this.createSource();
			}).then((json) => {
				if (!providersList.find((provider) => {
					return providerActive.slice(0, provider.length) == provider;
				})) {
					filter.render().find('.filter--search').addClass('hide');
				}
				this.search();
			}).catch((err) => {
				this.showNoConnectPage(err);
			});

			//return this.render();
		};
		/**
		 * Начать поиск
		 */
		this.search = function () { //this.loading(true)
			this.filter({
				source: filterSources
			}, this.getChoice());
			this.find();
		};
		this.find = function () {
			this.request(this.addLampacParams(providerActiveUrl));
		};
		this.request = function (url) {
			number_of_requests++;
			if (number_of_requests < 10) {
				network.native(url, this.parseVideosData.bind(this), this.showNoAnswerPage.bind(this), false, {
					dataType: 'text'
				});
				clearTimeout(number_of_requests_timer);
				number_of_requests_timer = setTimeout(() => {
					number_of_requests = 0;
				}, 4000);
			}
			else
				this.showEmptyPage();
		};
		/**
		 * parse html page into json array
		 * @param {string} htmlData 
		 * @param {string} className 
		 * @returns {{method:string,url:?string,img:?string,similar:?boolean,year:?number,quality:?Object.<string, string>,episode:?number,season:?number,title:?string,text:?string,vast_url:?string,vast_msg:?string,active:?boolean}[]}
		 **/
		this.parseVideosHtml = function (htmlData, className) {
			try {
				let html = $('<div>' + htmlData + '</div>');
				let elements = [];
				html.find(className).each(function () {
					let htmlItem = $(this);
					let data = JSON.parse(htmlItem.attr('data-json'));
					let season = htmlItem.attr('s');
					let episode = htmlItem.attr('e');
					let text = htmlItem.text();
					if (!object.movie.name) {
						if (text.match(/\d+p/i)) {
							if (!data.quality) {
								data.quality = {};
								data.quality[text] = data.url;
							}
							text = object.movie.title;
						}
						if (text == 'По умолчанию') {
							text = object.movie.title;
						}
					}
					if (episode)
						data.episode = parseInt(episode);
					if (season)
						data.season = parseInt(season);
					if (text)
						data.text = text;
					data.active = htmlItem.hasClass('active');
					elements.push(data);
				});
				return elements;
			}
			catch (err) {
				return [];
			}
		};
		// @todo: rework and optimize asap
		this.requestVideoData = function (file, call) {
			if (Lampa.Storage.field('player') !== 'inner' && file.stream && Lampa.Platform.is('apple')) {
				let streamFile = Lampa.Arrays.clone(file);
				streamFile.method = 'play';
				streamFile.url = file.stream;
				call(streamFile, {});
			}
			else if (file.method == 'play')
				call(file, {});
			else {
				Lampa.Loading.start(() => {
					Lampa.Loading.stop();
					Lampa.Controller.toggle('content');
					network.clear();
				});
				network.native(file.url, (json) => {
					if (json.rch) {
						this.rch(json, () => {
							Lampa.Loading.stop();
							this.requestVideoData(file, call);
						});
					}
					else {
						Lampa.Loading.stop();
						call(json, json);
					}
				}, () => {
					Lampa.Loading.stop();
					call(false, {});
				});
			}
		};
		/**
		 * @typedef PlayData
		 * @type {{title:string,url:string,url_reserve:string,quality:Object[],hls_type:?string,hls_manifest_timeout:?number,hls_retry_timeout:?number,timeline:Object,subtitles:?Object[],voiceovers:?Object[],vast_url:?string,vast_msg:?string,callback:Function}}
		 **/
		/**
		 * construct player object
		 * @param {Object} file source video file
		 * @returns {PlayData} player object
		 **/
		this.toPlayData = function (file) {
			return {
				title: file.title,
				url: file.url,
				quality: file.qualities,
				timeline: file.timeline,
				subtitles: file.subtitles,
				callback: file.markWatched
			};
		};
		/**
		 * parse primary and reserve urls
		 * @param {PlayData} play
		 **/
		this.setReserveUrl = function (play) {
			if (play.url && typeof play.url == 'string' && play.url.indexOf(' or ') !== -1) {
				let urls = play.url.split(' or ');
				play.url = urls[0];
				play.url_reserve = urls[1];
			}
		};
		/**
		 * parse qualities and set url based on default quality preference
		 * @param {PlayData} play
		 **/
		this.setDefaultQualityUrl = function (play) {
			if (Lampa.Arrays.getKeys(play.quality).length) {
				for (const key in play.quality) {
					const value = play.quality[key];
					if (parseInt(key) == Lampa.Storage.field('video_quality_default')) {
						play.url = value;
						this.setReserveUrl(play);
					}
					if (value.indexOf(' or ') !== -1)
						play.quality[key] = value.split(' or ')[0];
				}
			}
		};
		this.showVideos = function (videos) {
			this.drawList(videos, {
				onEnter: (video, html) => {
					this.requestVideoData(video, (json, json_call) => {
						if (!json || !json.url) {
							Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
							return;
						}

						let playlist = [];
						let playData = this.toPlayData(video);
						playData.url = json.url;
						playData.headers = json_call.headers || json.headers; // @test: unused
						playData.quality = json_call.quality || video.qualities;
						playData.hls_manifest_timeout = json_call.hls_manifest_timeout || json.hls_manifest_timeout;
						playData.subtitles = json.subtitles;
						// prevent preroll ads
						playData.vast_url = '';//json.vast_url;
						playData.vast_msg = '';//json.vast_msg;
						this.setReserveUrl(playData);
						this.setDefaultQualityUrl(playData);

						if (video.season) {
							// @todo: prepend episode index to title | set "group-title" as "Season N"?
							videos.forEach((episode) => {
								let playCell = this.toPlayData(episode);
								// prevent preroll ads
								playCell.vast_url = '';
								playCell.vast_msg = '';

								if (episode == video)
									playCell.url = json.url;
								else if (episode.method == 'call') {
									if (Lampa.Storage.field('player') !== 'inner') {
										playCell.url = episode.stream;
										delete playCell.quality;
									}
									else {
										playCell.url = (call) => {
											this.requestVideoData(episode, (stream, stream_json) => {
												if (stream.url) {
													playCell.url = stream.url;
													playCell.quality = stream_json.quality || episode.qualities;
													playCell.subtitles = stream.subtitles;
													this.setReserveUrl(playCell);
													this.setDefaultQualityUrl(playCell);
													episode.markWatched();
												}
												else {
													playCell.url = '';
													Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
												}
												call();
											}, () => {
												playCell.url = '';
												call();
											});
										};
									}
								}
								else
									playCell.url = episode.url;

								this.setReserveUrl(playCell);
								this.setDefaultQualityUrl(playCell);

								
								playlist.push(playCell);
							});

							if (playlist.length > 1)
								playData.playlist = playlist;
						}
						else
							playlist.push(playData);

						if (playData.url) {
							Lampa.Player.play(playData);
							Lampa.Player.playlist(playlist);
							video.markWatched();
							this.updateProvider(providerActive);
						}
						else
							Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
					}, true);
				},
				onContextMenu: (video, html, call) => {
					this.requestVideoData(video, (videoData) => {
						call({
							file: videoData.url,
							quality: video.qualities
						});
					}, true);
				}
			});

			this.filter({
				season: filterFound.season.map((s) => {
					return s.title;
				}),
				voice: filterFound.voice.map((b) => {
					return b.title;
				})
			}, this.getChoice());
		};
		this.parseVideosData = function(data) {
			let json = (Lampa.Arrays.isObject(data) && data.rch) ? data : Lampa.Arrays.decodeJson(data, {});
			if (json.rch)
				return this.rch(json);

			try {
				let videoItems = this.parseVideosHtml(data, '.videos__item');
				let videoButtons = this.parseVideosHtml(data, '.videos__button');

				if (videoItems.length == 1 && videoItems[0].method == 'link' && !videoItems[0].similar) {
					filterFound.season = videoItems.map((s) => {
						return {
							title: s.text,
							url: s.url
						};
					});
					this.replaceChoice({
						season: 0
					});
					this.request(videoItems[0].url);
				}
				else {
					this.activity.loader(false);

					let videoFiles = videoItems.filter((videoItem) => {
						return videoItem.method == 'play' || videoItem.method == 'call';
					});
					let videoSimilars = videoItems.filter((videoItem) => {
						return videoItem.similar;
					});

					if (videoFiles.length) {
						if (videoButtons.length) {
							filterFound.voice = videoButtons.map((b) => {
								return {
									title: b.text,
									url: b.url
								};
							});

							const choice = this.getChoice(providerActive);
							let selectedVoiceUrl = choice.voice_url;
							let selectedVoiceName = choice.voice_name;
							let foundVoiceUrl = videoButtons.find((v) => {
								return v.url == selectedVoiceUrl;
							});
							let foundVoiceName = videoButtons.find((v) => {
								return v.text == selectedVoiceName;
							});
							let foundVoiceIsActive = videoButtons.find((v) => {
								return v.active;
							});

							if (foundVoiceUrl && !foundVoiceUrl.active) {
								this.replaceChoice({
									voice: videoButtons.indexOf(foundVoiceUrl),
									voice_name: foundVoiceUrl.text
								});
								this.request(foundVoiceUrl.url);
							}
							else if (foundVoiceName && !foundVoiceName.active) {
								this.replaceChoice({
									voice: videoButtons.indexOf(foundVoiceName),
									voice_name: foundVoiceName.text
								});
								this.request(foundVoiceName.url);
							}
							else {
								if (foundVoiceIsActive) {
									this.replaceChoice({
										voice: videoButtons.indexOf(foundVoiceIsActive),
										voice_name: foundVoiceIsActive.text
									});
								}
								this.showVideos(videoFiles);
							}
						}
						else {
							this.replaceChoice({
								voice: 0,
								voice_url: '',
								voice_name: ''
							});
							this.showVideos(videoFiles);
						}
					}
					else if (videoItems.length) {
						if (videoSimilars.length) {
							this.showSimilars(videoSimilars);
							this.activity.loader(false);
						}
						else {
							//this.activity.loader(true)
							filterFound.season = videoItems.map((video) => {
								return {
									title: video.text,
									url: video.url
								};
							});

							const selectedSeason = this.getChoice(providerActive).season;
							const season = filterFound.season[selectedSeason] || filterFound.season[0]; // @test: debug this
							this.request(season.url);
						}
					}
					else
						this.showNoAnswerPage(data); // @todo: instead show human readable error text
				}
			}
			catch (err) {
				this.showNoAnswerPage(err);
			}
		};
		this.showSimilars = function(similars) {
			scroll.clear();
			similars.forEach((folder) => {
				folder.title = folder.text;
				folder.details = '';

				let details = [];
				const year = ((folder.start_date || folder.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
				if (year)
					details.push(year);
				if (folder.details)
					details.push(folder.details);

				folder.title = folder.title || folder.text;
				folder.time = folder.time || '';
				folder.details = details.join('<span class="qwatch-split">●</span>');

				let folderElement = Lampa.Template.get('qwatch_item_folder', folder);
				if (folder.img) {
					let imageElement = $('<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>');
					folderElement.find('.qwatch-item__folder').empty().append(imageElement);

					if (folder.img !== undefined) {
						if (folder.img.charAt(0) === '/')
							folder.img = hostAddress + folder.img.substring(1);
						if (folder.img.indexOf('/proxyimg') !== -1)
							folder.img = addAccountParams(folder.img);
					}

					Lampa.Utils.imgLoad(imageElement, folder.img);
				}

				folderElement.on('hover:enter', () => {
					this.resetPage();
					this.request(folder.url);
				}).on('hover:focus', (event) => {
					lastFocusTarget = event.target;
					scroll.update($(event.target), true);
				});
				scroll.append(folderElement);
			});

			this.filter({
				season: filterFound.season.map((s) => {
					return s.title;
				}),
				voice: filterFound.voice.map((v) => {
					return v.title;
				})
			}, this.getChoice());

			Lampa.Controller.enable('content');
		};
		// @todo: instead use 'online_filter'?
		this.getChoice = function(provider) {
			let choicesCache = Lampa.Storage.cache('online_choice_' + (provider || providerActive), 3000, {});
			let choice = choicesCache[object.movie.id] || {};
			Lampa.Arrays.extend(choice, {
				season: 0,
				voice: 0,
				voice_name: '',
				voice_id: 0,
				episodes_view: {},
				movie_view: ''
			});
			return choice;
		};
		this.saveChoice = function(choice, provider) {
			let choicesCache = Lampa.Storage.cache('online_choice_' + (provider || providerActive), 3000, {});
			choicesCache[object.movie.id] = choice;
			Lampa.Storage.set('online_choice_' + (provider || providerActive), choicesCache);
			this.updateProvider(provider || providerActive);
		};
		this.replaceChoice = function(choice, provider) {
			let destinationChoice = this.getChoice(provider);
			Lampa.Arrays.extend(destinationChoice, choice, true);
			this.saveChoice(destinationChoice, provider);
		};
		/**
		 * Очистить список файлов
		 */
		this.resetPage = function() {
			lastFocusTarget = false;
			clearInterval(providerTimer);
			network.clear();
			images.length = 0;
			scroll.render().find('.empty').remove();
			scroll.clear();
			scroll.reset();
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));
		};
		/**
		 * page loading
		 * @param {boolean} state
		 **/
		this.setLoading = function(state) {
			if (state)
				this.activity.loader(true);
			else {
				this.activity.loader(false);
				this.activity.toggle();
			}
		};
		/**
		 * Построить фильтр
		 */
		this.filter = function(filterItems, choice) {
			let selection = [];

			let addSelection = (type, title) => {
				let need = this.getChoice();
				let value = need[type];

				let fieldItems = filterItems[type];
				let subitems = [];
				fieldItems.forEach((name, i) => {
					subitems.push({
						title: name,
						selected: value == i,
						index: i
					});
				});

				selection.push({
					title: title,
					subtitle: fieldItems[value],
					items: subitems,
					stype: type
				});
			};
			filterItems.source = filterSources;
			selection.push({
				title: Lampa.Lang.translate('torrent_parser_reset'),
				reset: true
			});
			this.saveChoice(choice);

			if (filterItems.season && filterItems.season.length)
				addSelection('season', Lampa.Lang.translate('torrent_serial_season'));
			if (filterItems.voice && filterItems.voice.length)
				addSelection('voice', Lampa.Lang.translate('torrent_parser_voice'));

			filter.set('filter', selection);
			filter.set('sort', filterSources.map((sourceName) => {
				const source = providersAlive[sourceName];
				return {
					title: source.name,
					selected: sourceName == providerActive,
					ghost: !source.show,
					source: sourceName
				};
			}));
			this.showFilter(filterItems);
		};
		/**
		 * show filter selected items
		 * @param {Object} filterItems
		 **/
		this.showFilter = function(filterItems) {
			let need = this.getChoice();
			let select = [];

			for (const i in need) {
				if (filterItems[i] && filterItems[i].length) {
					if (i == 'voice')
						select.push(filterTranslation[i] + ': ' + filterItems[i][need[i]]);
					else if (i !== 'source' && filterItems.season.length >= 1)
						select.push(filterTranslation.season + ': ' + filterItems[i][need[i]]);
				}
			}

			filter.chosen('filter', select);
			filter.chosen('sort', [providersAlive[providerActive].name]);
		};
		/**
		 * request info about episodes of the current series season from an online database (e.g. TMDB)
		 * @param {number} season
		 * @param {Function} callback
		 **/
		this.requestEpisodes = function(season, callback) {
			let episodes = [];
			if (typeof object.movie.id == 'number' && object.movie.name) {
				const tmdbUrl = Lampa.TMDB.api('tv/' + object.movie.id + '/season/' + season + '?api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'ru'));
				network.timeout(15_000);
				network.native(tmdbUrl, (response) => {
					episodes = response["episodes"] || [];
					callback(episodes);
				}, (a, c) => {
					// @todo: dont call same callback on failure
					callback(episodes);
				});
			}
			else
				// @todo: dont call same callback on failure
				callback(episodes);
		};
		/**
		 * video list render
		 * @param {Object[]} videos
		 * @param {?Object.<Function>} callbacks
		 **/
		this.drawList = function(videos, callbacks) {
			callbacks = callbacks || {};
			if (!videos.length)
				return this.showEmptyPage();

			scroll.clear();

			/*
			let viewList = Lampa.Storage.cache('online_view', 5000, []);
			let choice = this.getChoice();

			let isFullWidth = window.innerWidth > 480;
			let scrollToMark = false;

			if (object.method === 'tv') {
				let scrollToLast = false;

				// @note: TMDB doesn't group animes by seasons, and uses absolute episode numbering for those
				this.requestEpisodes(Math.min(videos[0].season, object.number_of_seasons), (episodes) => {
					const maxEpisodeNumberLength = videos.length.toString().length;
					videos.forEach((element, index) => {
						let episode = episodes.length && !callbacks.similars ? episodes.find((e) => {
							return e.episode_number == element.episode;
						}) : false;

						let voiceName = choice.voice_name || (filterFound.voice[0] ? filterFound.voice[0].title : null) || element.voice_name;

						if (element.quality) {
							element.qualities = element.quality;
							element.quality = Lampa.Arrays.getKeys(element.quality)[0];
						}
						// set voice subscribe parameters
						if (element.voice_name) {
							element.translate_episode_end = this.getLastEpisode(videos);
							element.translate_voice = element.voice_name;
						}

						Lampa.Arrays.extend(element, {
							voice_name: voiceName,
							quality: '',
							time: Lampa.Utils.secondsToTime(episode.runtime * 60, true)
						});

						let hashFile = Lampa.Utils.hash([element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join(''));
						let hashTimeline = Lampa.Utils.hash([element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join(''));

						// @todo: when video switched via external player it's not marked as watched | add listener to timeline 'update' event / overload 'timeline.handler' | or add listener to playlist 'select' event, must cause less overhead
						element.timeline = Lampa.Timeline.view(hashTimeline);

						// construct details content
						let details = [];
						let rating = '';
						if (episode.vote_average)
							rating = Lampa.Template.get('qwatch_item_rating', {
								rate: episode.vote_average.toFixed(1)
							}, true);
						if (episode.air_date && isFullWidth)
							details.push(Lampa.Utils.parseTime(episode.air_date).full);
						if (element.details)
							details.push(element.details);
						element.details = rating + (details.length > 0 ? '<span>' + details.join('<span class="qwatch-split">●</span>') + '</span>' : '');


					});
				});
			}
			else {
				videos.forEach((element, index) => {
					let voiceName = choice.voice_name || (filterFound.voice[0] ? filterFound.voice[0].title : null) || element.voice_name || element.text;

					if (element.quality) {
						element.qualities = element.quality;
						element.quality = Lampa.Arrays.getKeys(element.quality)[0];
					}
					// replace title with extra info
					if (element.text)
						element.title = element.text;

					Lampa.Arrays.extend(element, {
						voice_name: voiceName,
						details: voiceName || 'Неизвестно',
						quality: '',
						time: Lampa.Utils.secondsToTime(object.movie.runtime * 60, true)
					});

					let hashFile = Lampa.Utils.hash(object.movie.original_title + element.voice_name);
					let hashTimeline = Lampa.Utils.hash(object.movie.original_title);

					element.timeline = Lampa.Timeline.view(hashTimeline);

					// construct details content
					let details = [];
					if (object.movie.release_date && isFullWidth)
						details.push(Lampa.Utils.parseTime(object.movie.release_date).full);
					if (object.movie.tagline && element.details.length < 32)
						details.push(object.movie.tagline);
					if (element.details)
						details.push(element.details);
					element.details = (details.length > 0 ? '<span>' + details.join('<span class="qwatch-split">●</span>') + '</span>' : '');
				});
			}*/
			
			// @note: TMDB doesn't group animes by seasons, and uses absolute episode numbering for those
			const seasonNumber = Math.min(videos[0].season, object.movie.number_of_seasons || 1);
			
			this.requestEpisodes(seasonNumber, (episodes) => {
				let viewList = Lampa.Storage.cache('online_view', 5000, []);
				let choice = this.getChoice();

				let isFullWidth = window.innerWidth > 480;
				let scrollToLast = null;
				let scrollToMark = null;

				// @todo: TMDB doesn't group animes by seasons, and uses absolute episode numbering for those
				const maxEpisodeNumberLength = videos.length.toString().length;
				videos.forEach((element, index) => {
					let episode = object.method === 'tv' && episodes.length && !callbacks.similars ? episodes.find((e) => {
						return e.episode_number == element.episode;
					}) : null;
					let episodeNumber = element.episode || index + 1;

					let voiceName = choice.voice_name || (filterFound.voice[0] ? filterFound.voice[0].title : null) || element.voice_name || (object.method === 'tv' ? 'Неизвестно' : element.text) || 'Неизвестно';
					if (element.quality) {
						element.qualities = element.quality;
						element.quality = Lampa.Arrays.getKeys(element.quality)[0];
					}

					Lampa.Arrays.extend(element, {
						details: voiceName,
						quality: '',
						time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
					});

					let hashFile = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, voiceName].join('') : object.movie.original_title + voiceName);
					let hashTimeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);

					if (element.season && voiceName) {
						element.translate_episode_end = this.getLastEpisode(videos);
						element.translate_voice = voiceName;
					}
					if (element.text && !episode)
						element.title = element.text;

					// @todo: when video switched via external player it's not marked as watched | add listener to timeline 'update' event / overload 'timeline.handler' | or add listener to playlist 'select' event, must cause less overhead
					element.timeline = Lampa.Timeline.view(hashTimeline);

					let details = [];
					let rating = '';
					if (episode) {
						element.title = episode.name;

						if (episode.vote_average)
							rating = Lampa.Template.get('qwatch_item_rating', {
								rate: episode.vote_average.toFixed(1)
							}, true);

						if (episode.air_date && isFullWidth)
							details.push(Lampa.Utils.parseTime(episode.air_date).full);
					}
					else if (isFullWidth) {
						if (object.movie.release_date)
							details.push(Lampa.Utils.parseTime(object.movie.release_date).full);
						if (object.movie.tagline && element.details.length < 32)
							details.push(object.movie.tagline);
					}
					if (element.details)
						details.push(element.details);
					element.details = rating + (details.length > 0 ? '<span>' + details.join('<span class="qwatch-split">●</span>') + '</span>' : '');

					let html = Lampa.Template.get('qwatch_item_full', element);
					// set scroll target
					if (object.method === 'movie') {
						// check if the current item is watched last
						if (choice.movie_view == hashFile)
							scrollToLast = html;
					}
					else {
						// check if the current episode is watched last
						const episodeLastWatched = choice.episodes_view[element.season];
						if (episodeLastWatched !== undefined && episodeLastWatched == episodeNumber)
							scrollToLast = html;
					}

					// load item image
					let loader = html.find('.qwatch__loader');
					let image = html.find('.qwatch-item__img');
					if (object.method === 'tv' && !episode) {
						image.append('<div class="qwatch-item__episode-number"><span>' + String(episodeNumber).padStart(maxEpisodeNumberLength, '0') + '</span></div>'); // @test: 'String.prototype.padStart()' is available since ES8
						loader.remove();
					}
					else if (object.method === 'movie' && ['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1)
						loader.remove();
					else {
						let thumbImg = html.find('img')[0];
						thumbImg.onerror = () => {
							thumbImg.src = './img/img_broken.svg';
						};
						thumbImg.onload = () => {
							image.addClass('qwatch-item__img--loaded');
							loader.remove();
							if (object.method === 'tv')
								image.append('<div class="qwatch-item__episode-number"><span>' + String(episodeNumber).padStart(maxEpisodeNumberLength, '0') + '</span></div>'); // @test: 'String.prototype.padStart()' is available since ES8
						};
						thumbImg.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
						images.push(thumbImg);
					}

					html.find('.qwatch-item__timeline').append(Lampa.Timeline.render(element.timeline));
					// @todo: can be moved inplace of movie runtime when watched
					//html.find('.qwatch-item__timeline').append(Lampa.Timeline.details(element.timeline));

					if (viewList.indexOf(hashFile) !== -1) {
						scrollToMark = html;
						html.find('.qwatch-item__img').append('<div class="qwatch-item__watched">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
					}

					element.clearTimeline = () => {
						element.timeline.percent = 0;
						element.timeline.time = 0;
						element.timeline.duration = 0;
						Lampa.Timeline.update(element.timeline);
					};
					/**
					 * mark video as watched, max out the timeline and save choice
					 **/
					element.markWatched = () => {
						// @note: 'online_view' is internal variable that affects other aspects
						viewList = Lampa.Storage.cache('online_view', 5000, []);
						if (viewList.indexOf(hashFile) == -1) {
							viewList.push(hashFile);
							Lampa.Storage.set('online_view', viewList);
							
							if (html.find('.qwatch-item__watched').length == 0)
								html.find('.qwatch-item__img').append('<div class="qwatch-item__watched">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
						}

						// max out the timeline
						element.timeline.percent = 100;
						Lampa.Timeline.update(element.timeline);

						choice = this.getChoice();
						if (object.method === 'movie')
							choice.movie_view = hashFile;
						else
							choice.episodes_view[element.season] = episodeNumber;
						this.saveChoice(choice);
					};
					element.unmarkWatched = () => {
						// @note: 'online_view' is internal variable that affects other aspects
						viewList = Lampa.Storage.cache('online_view', 5000, []);
						if (viewList.indexOf(hashFile) !== -1) {
							Lampa.Arrays.remove(viewList, hashFile);
							Lampa.Storage.remove('online_view', hashFile);

							html.find('.qwatch-item__watched').remove();
							element.clearTimeline();
						}
					};

					html.on('hover:enter', () => {
						if (object.movie.id)
							Lampa.Favorite.add('history', object.movie, 100);
						if (callbacks.onEnter)
							callbacks.onEnter(element, html);
					}).on('hover:focus', (event) => {
						lastFocusTarget = event.target;
						if (callbacks.onFocus)
							callbacks.onFocus(element, html);
						scroll.update($(event.target), true);
					});
					if (callbacks.onRender)
						callbacks.onRender(element, html);

					this.contextMenu({
						html: html,
						element: element,
						onFile: (call) => {
							if (callbacks.onContextMenu)
								callbacks.onContextMenu(element, html, call);
						},
						onClearAllMark: () => {
							for (let video of videos)
								video.unmarkWatched();
						},
						onClearAllTime: () => {
							for (let video of videos)
								video.timeclear();
						}
					});
					scroll.append(html);
				});

				// append ongoing episodes
				// @todo: process those within released ones
				/*
				 * @todo: TMDB doesn't group animes by seasons, and uses absolute episode numbering for those
				 * to fix that we can make request to "https://api.themoviedb.org/3/tv/{series_id}" and use "next_episode_to_air" from there
				 */
				const lastEpisodeToAirNumber = object.last_episode_to_air ? object.last_episode_to_air.episode_number : 0;
				const nextEpisodeToAirNumber = object.next_episode_to_air ? object.next_episode_to_air.episode_number : 0;
				if (nextEpisodeToAirNumber && videos.length >= lastEpisodeToAirNumber && episodes.length > videos.length && !callbacks.similars) {
					let episodesToAir = episodes.slice(nextEpisodeToAirNumber, videos.length);
					episodesToAir.forEach((episode) => {
						let details = [];
						let rating = '';
						if (episode.vote_average)
							rating = Lampa.Template.get('qwatch_item_rating', {
								rate: episode.vote_average.toFixed(1)
							}, true);

						let daysLeft = 0;
						if (episode.air_date) {
							details.push(Lampa.Utils.parseTime(episode.air_date).full);

							let airDate = new Date(episode.air_date.replace(/-/g, '/'));
							daysLeft = Math.round((airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
						}

						let html = Lampa.Template.get('qwatch_item_full', {
							title: episode.name,
							time: Lampa.Utils.secondsToTime(episode.runtime * 60, true),
							details: rating + (details.length > 0 ? '<span>' + details.join('<span class="qwatch-split">●</span>') + '</span>' : ''),
							quality: (daysLeft > 0 ? (Lampa.Lang.translate('full_episode_days_left') + ': ' + daysLeft) : Lampa.Lang.translate('tv_status_post_production'))
						});

						let loader = html.find('.qwatch__loader');
						let image = html.find('.qwatch-item__img');
						let season = videos[0] ? videos[0].season : 1;
						html.find('.qwatch-item__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
						let thumbnail = html.find('img')[0];
						if (episode.still_path) {
							thumbnail.onerror = () => {
								thumbnail.src = './img/img_broken.svg';
							};
							thumbnail.onload = () => {
								image.addClass('qwatch-item__img--loaded');
								loader.remove();
								image.append('<div class="qwatch-item__episode-number"><span>' + String(episode.episode_number).padStart(maxEpisodeNumberLength, '0') + '</span></div>');
							};
							thumbnail.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
							images.push(thumbnail);
						}
						else {
							loader.remove();
							image.append('<div class="qwatch-item__episode-number"><span>' + String(episode.episode_number).padStart(maxEpisodeNumberLength, '0') + '</span></div>');
						}

						html.on('hover:focus', (event) => {
							lastFocusTarget = event.target;
							scroll.update($(event.target), true);
						});
						html.css('opacity', '0.5');
						scroll.append(html);
					});
				}

				if (scrollToLast)
					lastFocusTarget = scrollToLast[0];
				else if (scrollToMark)
					lastFocusTarget = scrollToMark[0];

				Lampa.Controller.enable('content');
			});
		};
		/**
		 * video context menu
		 * @param {{html:Object,element:Object,onFile:Function,onClearAllMark:Function,onClearAllTime:Function}} params
		 **/
		this.contextMenu = function(params) {
			params.html.on('hover:long', () => {
				function show(extra) {					
					let menu = [];
					if (Lampa.Platform.is('webos')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - WebOS',
							player: 'webos'
						});
					}
					else if (Lampa.Platform.is('android')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - Android',
							player: 'android'
						});
					}
					menu.push({
						title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
						player: 'lampa'
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_video'),
						separator: true
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_title'),
						onSelect: params.element.markWatched
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
						onSelect: params.element.unmarkWatched
					});
					menu.push({
						title: Lampa.Lang.translate('time_reset'),
						onSelect: params.element.timeclear
					});
					if (extra) {
						menu.push({
							title: Lampa.Lang.translate('copy_link'),
							copylink: true
						});
					}
					if (window.qwatch_online_context_menu)
						window.qwatch_online_context_menu.push(menu, extra, params);
					menu.push({
						title: Lampa.Lang.translate('more'),
						separator: true
					});
					if (Lampa.Account.logged() && params.element.season !== undefined && params.element.translate_voice) {
						menu.push({
							title: Lampa.Lang.translate('qwatch_voice_subscribe'),
							onSelect: () => {
								Lampa.Account.subscribeToTranslation({
									card: object.movie,
									season: params.element.season,
									episode: params.element.translate_episode_end,
									voice: params.element.translate_voice
								}, () => {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_success'));
								}, () => {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_error'));
								});
							}
						});
					}
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_marks'),
						onSelect: params.onClearAllMark
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_timecodes'),
						onSelect: params.onClearAllTime
					});

					const controllerName = Lampa.Controller.enabled().name;
					Lampa.Select.show({
						title: Lampa.Lang.translate('title_action'),
						items: menu,
						onBack: () => {
							Lampa.Controller.toggle(controllerName);
						},
						onSelect: (item) => {
							// @test: unused
							if (window.qwatch_online_context_menu)
								window.qwatch_online_context_menu.onSelect(item, params);

							// process items callbacks
							if (item.onSelect)
								item.onSelect();

							Lampa.Controller.toggle(controllerName);

							if (item.player) {
								// @todo: continue from the last timeline
								Lampa.Player.runas(item.player);
								params.html.trigger('hover:enter');
							}
						}
					});
				}

				params.onFile(show);
			}).on('hover:focus', () => {
				if (Lampa.Helper)
					Lampa.Helper.show('qwatch_file', Lampa.Lang.translate('helper_torrents'), params.html);
			});
		};
		this.showEmptyPage = function() {
			let html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('empty_title_two'));
			html.find('.qwatch-empty__time').text(Lampa.Lang.translate('empty_text'));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoConnectPage = function(err) {
			let html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('title_error'));
			html.find('.qwatch-empty__time').text(err && err["accsdb"] ? err["msg"] : Lampa.Lang.translate('qwatch_provider_no_results').replace('{provider}', providersAlive[providerActive].name));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoAnswerPage = function(err) {
			this.resetPage();

			let html = Lampa.Template.get('qwatch_page_no_answer', {
				provider: providerActive
			});

			if (err && err["accsdb"])
				html.find('.qwatch-empty__title').html(err["msg"]);

			let tic = err && err["accsdb"] ? 10 : 5;
			html.find('.cancel').on('hover:enter', () => {
				clearInterval(providerTimer);
			});
			html.find('.change').on('hover:enter', () => {
				clearInterval(providerTimer);
				filter.render().find('.filter--sort').trigger('hover:enter');
			});
			scroll.clear();
			scroll.append(html);

			this.setLoading(false);
			providerTimer = setInterval(() => {
				tic--;
				html.find('.timeout').text(tic);
				if (tic == 0) {
					clearInterval(providerTimer);
					let keys = Lampa.Arrays.getKeys(providersAlive);
					let next = keys[keys.indexOf(providerActive) + 1];
					if (!next)
						next = keys[0];
					providerActive = next;
					if (Lampa.Activity.active().activity == this.activity)
						this.changeProvider(providerActive);
				}
			}, 1000);
		};
		this.getLastEpisode = function(videos) {
			let lastEpisode = 0;
			for (let video of videos) {
				if (video.episode !== undefined)
					lastEpisode = Math.max(lastEpisode, parseInt(video.episode));
			}
			return lastEpisode;
		};
		/**
		 * Начать навигацию по файлам
		 */
		this.start = function() {
			if (Lampa.Activity.active().activity !== this.activity)
				return;

			Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
			Lampa.Controller.add('content', {
				toggle: () => {
					Lampa.Controller.collectionSet(scroll.render(), explorer.render());
					Lampa.Controller.collectionFocus(lastFocusTarget || false, scroll.render());
				},
				gone: () => {
					clearTimeout(providerTimer);
				},
				up: () => {
					if (Navigator.canmove('up'))
						Navigator.move('up');
					else
						Lampa.Controller.toggle('head');
				},
				down: () => {
					Navigator.move('down');
				},
				right: () => {
					if (Navigator.canmove('right'))
						Navigator.move('right');
					else
						filter.show(Lampa.Lang.translate('title_filter'), 'filter');
				},
				left: () => {
					if (Navigator.canmove('left'))
						Navigator.move('left');
					else
						Lampa.Controller.toggle('menu');
				},
				back: Lampa.Activity.backward
			});
			Lampa.Controller.toggle('content');
		};
		/**
		 * activity render callback
		 **/
		this.render = function() {
			return explorer.render();
		};
		this.pause = function() { };
		this.stop = function() { };
		/**
		 * activity destroy callback
		 **/
		this.destroy = function() {
			network.clear();
			images.length = 0;
			explorer.destroy();
			scroll.destroy();
			clearInterval(providerTimer);
			clearTimeout(life_wait_timer);
			if (hubConnection) {
				clearTimeout(hubTimer);
				hubConnection.stop();
				hubConnection = null;
			}
		};
	}

	/*function addSourceSearch(spiderName, spiderUri) {
		let network = new Lampa.Reguest();

		let source = {
			title: spiderName,
			search: (params, onComplete) => {
				function searchComplite(links) {
					let keys = Lampa.Arrays.getKeys(links);
					if (keys.length > 0) {
						let status = new Lampa.Status(keys.length);
						status.onComplite = (result) => {
							let rows = [];

							keys.forEach((name) => {
								let line = result[name];

								if (line && line.data && line.type == 'similar') {
									let cards = line.data.map((item) => {
										item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
										item.release_date = item.year || '0000';
										item.provider = spiderUri;
										if (item.img !== undefined) {
											if (item.img.charAt(0) === '/')
												item.img = hostAddress + item.img.substring(1);
											if (item.img.indexOf('/proxyimg') !== -1)
												item.img = addAccountParams(item.img);
										}

										return item;
									});

									rows.push({
										title: name,
										results: cards
									});
								}
							})

							onComplete(rows);
						}

						keys.forEach((name) => {
							network.silent(links[name], (response) => {
								status.append(name, response);
							}, () => {
								status.error();
							})
						})
					}
					else
						onComplete([]);
				}

				network.silent(hostAddress + 'lite/' + spiderUri + '?title=' + params.query, (response) => {
					if (response.rch) {
						rchRun(response, () => {
							network.silent(hostAddress + 'lite/' + spiderUri + '?title=' + params.query, (links) => {
								searchComplite(links);
							}, () => {
								onComplete([]);
							});
						});
					}
					else
						searchComplite(response);
				}, () => {
					onComplete([]);
				});
			},
			onCancel: () => {
				network.clear()
			},
			params: {
				lazy: true,
				align_left: true,
				card_events: {
					onMenu: () => { }
				}
			},
			onMore: (params, close) => {
				close();
			},
			onSelect: (params, close) => {
				close();

				Lampa.Activity.push({
					url: params.element.url,
					title: 'QWatch - ' + params.element.title,
					component: 'qwatch',
					movie: params.element,
					search: params.element.title,
					clarification: true,
					provider: params.element.provider,
					noinfo: true
				});
			}
		}

		Lampa.Search.addSource(source);
	}*/

	function startPlugin() {
		window.plugin_qwatch_ready = true;

		let manifest = {
			type: 'video',
			version: '1.0.0',
			name: 'QWatch',
			description: 'Плагин для онлайн просмотра фильмов и сериалов',
			component: 'qwatch'
		};
		Lampa.Manifest.plugins = manifest;

		Lampa.Lang.add({
			qwatch_title: {
				ru: 'Онлайн',
				uk: 'Онлайн',
				en: 'Online',
				zh: '在线的'
			},
			qwatch_video: {
				ru: 'Видео',
				en: 'Video',
				uk: 'Відео',
				zh: '视频'
			},
			qwatch_no_watch_history: {
				ru: 'Нет истории просмотра',
				en: 'No browsing history',
				ua: 'Немає історії перегляду',
				zh: '没有浏览历史'
			},
			qwatch_no_link: {
				ru: 'Не удалось извлечь ссылку',
				uk: 'Неможливо отримати посилання',
				en: 'Failed to fetch link',
				zh: '获取链接失败'
			},
			qwatch_voice_subscribe: {
				ru: 'Подписаться на перевод',
				uk: 'Підписатися на переклад',
				en: 'Subscribe to translation',
				zh: '订阅翻译'
			},
			qwatch_voice_success: {
				ru: 'Вы успешно подписались',
				uk: 'Ви успішно підписалися',
				en: 'You have successfully subscribed',
				zh: '您已成功订阅'
			},
			qwatch_voice_error: {
				ru: 'Возникла ошибка',
				uk: 'Виникла помилка',
				en: 'An error has occurred',
				zh: '发生了错误'
			},
			qwatch_clear_all_marks: {
				ru: 'Очистить все метки',
				uk: 'Очистити всі мітки',
				en: 'Clear all labels',
				zh: '清除所有标签'
			},
			qwatch_clear_all_timecodes: {
				ru: 'Очистить все тайм-коды',
				uk: 'Очистити всі тайм-коди',
				en: 'Clear all timecodes',
				zh: '清除所有时间代码'
			},
			qwatch_source_change: {
				ru: 'Изменить источник',
				uk: 'Змінити балансер',
				en: 'Change source',
				zh: '更改平衡器'
			},
			qwatch_provider_timeout: {
				ru: 'Источник будет переключен автоматически через <span class="timeout">10</span> секунд.',
				uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
				en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
				zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
			},
			qwatch_provider_no_results: {
				ru: 'Поиск на "{provider}" не дал результатов',
				uk: 'Пошук на "{provider}" не дав результатів',
				en: 'Search on "{provider}" did not return any results',
				zh: '搜索 "{provider}" 未返回任何结果'
			}
		});

		// register css styles
		Lampa.Template.add('qwatch_css',
			'<style>' +
			'@charset \'UTF-8\';' +
			'.torrent-item--qwatch{padding:unset !important;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.torrent-item--qwatch .qwatch-split{font-size:.8em;margin:0 .5em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch-item__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}' +
			'@media screen and (max-width:480px){.qwatch-item__body{padding:.8em 1.2em}}' +
			'.qwatch-item__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}' +
			'.qwatch-item__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-top-left-radius:.3em;-webkit-border-bottom-left-radius:.3em;border-top-left-radius:.3em;border-bottom-left-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}' +
			'.qwatch-item__img--loaded>img{opacity:1}@media screen and (max-width:480px){.qwatch-item__img{width:7em;min-height:6em}}' +
			'.qwatch-item__folder{-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch-item__folder>svg{margin:1em;width:4.4em;height:4.4em}' +
			'.qwatch-item__watched{position:absolute;top:1em;left:1em;background:rgba(0,0,0,.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}' +
			'.qwatch-item__watched>svg{width:1.5em !important;height:1.5em !important}' +
			'.qwatch-item__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em;font-weight:600}' +
			'.qwatch-item__episode-number>span{background-color:rgba(0,0,0,.45);-webkit-border-radius:.2em;-moz-border-radius:.2em;border-radius:.2em;padding:.2em;}' +
			'.qwatch__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}' +
			'.qwatch-item__head,.qwatch-item__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-item__timeline{margin:.8em 0}' +
			'.qwatch-item__timeline>.time-line{display:block !important}' +
			'.qwatch-item__timeline>.time-line>div{-webkit-transition:width .3s;-o-transition:width .3s;-moz-transition:width .3s;transition:width .3s}' +
			'.qwatch-item__title{font-size:1.6em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'@media screen and (max-width:480px){.qwatch-item__title{font-size:1.4em}}' +
			'.qwatch-item__time{padding-left:2em}' +
			'.qwatch-item__details{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-item__details>span{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'.qwatch-item__quality{padding-left:1em;white-space:nowrap}' +
			'.qwatch-item--folder .qwatch-item__footer{margin-top:.8em}' +
			'.qwatch-item__rating{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;margin-right:.5em}' +
			'.qwatch-item__rating>svg{width:1.2em;height:1.2em}' +
			'.qwatch-item__rating>span{font-weight:600;padding-left:.25em}' +
			'.qwatch-empty{line-height:1.4}' +
			'.qwatch-empty__title{font-size:1.8em;margin-bottom:.3em}' +
			'.qwatch-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}' +
			'.qwatch-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.qwatch-empty__buttons>*+*{margin-left:1em}' +
			'.qwatch-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}' +
			'.qwatch-empty__button.focus{background:#fff;color:black}' +
			'.qwatch-empty__list .qwatch-empty-skeleton:nth-child(2){opacity:.5}' +
			'.qwatch-empty__list .qwatch-empty-skeleton:nth-child(3){opacity:.2}' +
			'.qwatch-empty-skeleton{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-skeleton>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-skeleton__ico{width:4em;height:4em;margin-right:2.4em}' +
			'.qwatch-empty-skeleton__body{height:1.6em;width:70%}' +
			'.qwatch-empty-skeleton+.qwatch-empty-skeleton{margin-top:1em}' +
			'</style>');
		$('body').append(Lampa.Template.get('qwatch_css', {}, true));

		Lampa.Listener.add('full', (event) => {
			if (event.type != 'complite')
				return;

			// render button
			let onlineButton = $(Lampa.Lang.translate(
				'<div class="full-start__button selector view--qwatch" data-subtitle="' + manifest.name + ' ' + manifest.version + '">' +
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M3.07 6a8.025 8.025 0 014.262-3.544A12.802 12.802 0 005.595 6H3.07zm-.818 2A8.015 8.015 0 002 10c0 .69.088 1.36.252 2h2.89A13.886 13.886 0 015 10c0-.704.051-1.371.143-2H2.252zm4.916 0C7.06 8.62 7 9.286 7 10c0 .713.061 1.38.168 2h5.664c.107-.62.168-1.287.168-2 0-.714-.061-1.38-.168-2H7.168zm7.69 0c.09.629.142 1.296.142 2s-.051 1.371-.143 2h2.891c.165-.64.252-1.31.252-2s-.087-1.36-.252-2h-2.89zm2.072-2h-2.525a12.805 12.805 0 00-1.737-3.544A8.025 8.025 0 0116.93 6zm-4.638 0H7.708c.324-.865.725-1.596 1.124-2.195.422-.633.842-1.117 1.168-1.452.326.335.746.82 1.168 1.452.4.599.8 1.33 1.124 2.195zm-1.124 10.195c.4-.599.8-1.33 1.124-2.195H7.708c.324.865.725 1.596 1.124 2.195.422.633.842 1.117 1.168 1.452.326-.335.746-.82 1.168-1.452zM3.07 14h2.525a12.802 12.802 0 001.737 3.544A8.025 8.025 0 013.07 14zm9.762 3.305a12.9 12.9 0 01-.164.24A8.025 8.025 0 0016.93 14h-2.525a12.805 12.805 0 01-1.573 3.305zM20 10c0 5.52-4.472 9.994-9.99 10h-.022C4.47 19.994 0 15.519 0 10 0 4.477 4.477 0 10 0s10 4.477 10 10z"/></svg>' +
				'<span>#{qwatch_title}</span>' +
				'</div>'));
			let render = event.object.activity.render();
			let torrentButton = render.find('.view--torrent');
			if (torrentButton.length > 0)
				torrentButton.before(onlineButton);
			else
				render.find('.full-start__button:last').after(onlineButton);

			// register button action
			onlineButton.on('hover:enter', () => {
				// register templates
				Lampa.Template.add('qwatch_item_full', 
					'<div class="torrent-item torrent-item--qwatch selector">' +
						'<div class="qwatch-item__img">' +
							'<img alt="">' +
							'<div class="qwatch__loader"/>' +
						'</div>' +
						'<div class="qwatch-item__body">' +
							'<div class="qwatch-item__head">' +
								'<div class="qwatch-item__title">{title}</div>' +
								'<div class="qwatch-item__time">{time}</div>' +
							'</div>' +
							'<div class="qwatch-item__timeline"/>' +
							'<div class="qwatch-item__footer">' +
								'<div class="qwatch-item__details">{details}</div>' +
								'<div class="qwatch-item__quality">{quality}</div>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_item_folder', 
					'<div class="torrent-item torrent-item--qwatch qwatch-item--folder selector">' +
						'<div class="qwatch-item__folder">' +
							'<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 128 112" fill="currentColor"><rect y="20" width="128" height="92" rx="13"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill-opacity="0.51"/></svg>' +
						'</div>' +
						'<div class="qwatch-item__body">' +
							'<div class="qwatch-item__head">' +
								'<div class="qwatch-item__title">{title}</div>' +
								'<div class="qwatch-item__time">{time}</div>' +
							'</div>' +
							'<div class="qwatch-item__footer">' +
								'<div class="qwatch-item__details">{details}</div>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_item_rating', 
					'<div class="qwatch-item__rating">' +
						Lampa.Template.get('icon_star', {}, true) +
						'<span>{rate}</span>' +
					'</div>');
				Lampa.Template.add('qwatch_page_content_loader',
					'<div class="qwatch-empty">' +
						'<div class="broadcast__scan"><div/></div>' +
						'<div class="qwatch-empty__list">' +
							'<div class="qwatch-empty-skeleton selector">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_page_no_answer',
					'<div class="qwatch-empty">' +
						'<div class="qwatch-empty__title">#{qwatch_provider_no_results}</div>' +
						'<div class="qwatch-empty__time">#{qwatch_provider_timeout}</div>' +
						'<div class="qwatch-empty__buttons">' +
							'<div class="qwatch-empty__button selector cancel">#{cancel}</div>' +
							'<div class="qwatch-empty__button selector change">#{qwatch_source_change}</div>' +
						'</div>' +
						'<div class="qwatch-empty__list">' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>'+
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
						'</div>' +
					'</div>');

				// register component
				Lampa.Component.add('qwatch', QWatchComponent);

				// register activity
				let clarificationSearch = clarificationSearchGet(event.data.movie.id);
				Lampa.Activity.push({
					url: '',
					title: Lampa.Lang.translate('qwatch_title'),
					component: 'qwatch',
					movie: event.data.movie,
					method: event.data.movie.name ? 'tv' : 'movie',
					// @todo: probably better to move those inside component
					search: clarificationSearch ? clarificationSearch : event.data.movie.title,
					clarification: clarificationSearch ? true : false
				});
			});
		});

		if (Lampa.Manifest.app_digital >= 177) {
			for (const providerName of providersList) {
				// @todo: rename to prevent conflicts with other plugins
				Lampa.Storage.sync('online_choice_' + providerName, 'object_object');
			}
		}
	}

	if (!window.plugin_qwatch_ready)
		startPlugin();
})();
